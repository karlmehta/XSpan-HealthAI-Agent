import cron from 'node-cron';
import { execFile } from 'child_process';
import { loadConfig } from '../config/index.js';
import { LocalStore } from '../storage/local-store.js';
import { XSpanApiClient } from '../sync/xspan-api.js';
import { DataPipeline } from '../sync/data-pipeline.js';
import { startMcpServer } from '../mcp/server.js';

// ── XSpan Health AI Agent — Main Daemon ─────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  XSpan HealthAI Agent v1.0.0              ║');
  console.log('║  Local-first health intelligence daemon   ║');
  console.log('╚═══════════════════════════════════════════╝');

  // Load configuration
  const config = loadConfig();
  console.log('[Agent] Configuration loaded');

  // Initialize local store
  const store = new LocalStore(config.storage.dataDir);
  console.log(`[Agent] SQLite store initialized at ${config.storage.dataDir}/xspan.db`);

  // Create API client
  const apiClient = new XSpanApiClient(config);
  const connected = await apiClient.checkConnectivity();
  if (connected) {
    console.log('[Agent] XSpan Cloud API connected');
  } else {
    console.warn('[Agent] XSpan Cloud API unreachable — will retry on next sync');
  }

  // Create data pipeline
  const pipeline = new DataPipeline(config);

  // Run initial sync
  console.log('[Agent] Running initial data sync...');
  const initialCount = await pipeline.syncAll(store);
  if (initialCount > 0) {
    await pipeline.synthesizeBiomarkers(store);
  }
  console.log(`[Agent] Initial sync complete: ${initialCount} records`);

  // ── Scheduled Jobs ──────────────────────────────────────────────

  // Health data sync (every N minutes)
  const syncInterval = config.schedules.syncIntervalMinutes;
  cron.schedule(`*/${syncInterval} * * * *`, async () => {
    console.log('[Cron] Running scheduled health sync...');
    try {
      await pipeline.syncAll(store);
    } catch (error) {
      console.error('[Cron] Health sync failed:', error);
    }
  });
  console.log(`[Agent] Health sync scheduled every ${syncInterval} minutes`);

  // Morning nudges
  cron.schedule(config.schedules.nudgeMorning, async () => {
    await fetchAndDeliverNudges(store, apiClient, config.notifications.enabled, 'morning');
  });

  // Midday nudges
  cron.schedule(config.schedules.nudgeMidday, async () => {
    await fetchAndDeliverNudges(store, apiClient, config.notifications.enabled, 'midday');
  });

  // Evening nudges
  cron.schedule(config.schedules.nudgeEvening, async () => {
    await fetchAndDeliverNudges(store, apiClient, config.notifications.enabled, 'evening');
  });
  console.log('[Agent] Nudge schedule configured (3x daily)');

  // Cloud sync (every N minutes — synthesize biomarkers and push to XSpan)
  const cloudInterval = config.schedules.cloudSyncIntervalMinutes;
  cron.schedule(`*/${cloudInterval} * * * *`, async () => {
    console.log('[Cron] Running cloud sync...');
    try {
      const vector = await pipeline.synthesizeBiomarkers(store);
      const response = await apiClient.syncBiomarkers(vector);
      if (response) {
        console.log(`[Cron] Cloud sync complete — twin updated: ${response.digitalTwinUpdated}`);
      }
    } catch (error) {
      console.error('[Cron] Cloud sync failed:', error);
    }
  });
  console.log(`[Agent] Cloud sync scheduled every ${cloudInterval} minutes`);

  // Weekly Health Passport generation (default: Sunday 7 AM)
  cron.schedule(config.schedules.passportGeneration, async () => {
    console.log('[Cron] Generating weekly Health Passport...');
    try {
      const passport = await apiClient.getHealthPassport();
      if (passport) {
        store.insertPassport(passport);
        console.log(`[Cron] Health Passport generated: score ${passport.overallScore}/100`);

        if (config.notifications.enabled) {
          sendNotification(
            'Weekly Health Passport Ready',
            `Overall Score: ${passport.overallScore}/100. Open Claude to review.`,
          );
        }
      }
    } catch (error) {
      console.error('[Cron] Passport generation failed:', error);
    }
  });
  console.log('[Agent] Weekly passport generation scheduled');

  // ── Start MCP Server ───────────────────────────────────────────

  console.log('[Agent] Starting MCP server...');
  await startMcpServer(store, apiClient, pipeline);

  // ── Graceful Shutdown ───────────────────────────────────────────

  const shutdown = () => {
    console.log('\n[Agent] Shutting down gracefully...');
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── Nudge Delivery ────────────────────────────────────────────────

async function fetchAndDeliverNudges(
  store: LocalStore,
  apiClient: XSpanApiClient,
  notificationsEnabled: boolean,
  timeOfDay: string,
) {
  console.log(`[Cron] Fetching ${timeOfDay} nudges...`);
  try {
    const nudges = await apiClient.getNudges(undefined, 5);

    for (const nudge of nudges) {
      nudge.deliveredAt = new Date().toISOString();
      store.insertNudge(nudge);

      if (notificationsEnabled) {
        sendNotification('XSpan Health Nudge', nudge.content);
      }
    }

    console.log(`[Cron] Delivered ${nudges.length} ${timeOfDay} nudges`);
  } catch (error) {
    console.error(`[Cron] ${timeOfDay} nudge fetch failed:`, error);
  }
}

/**
 * Send a macOS notification using osascript.
 * Falls back silently on non-macOS platforms.
 */
function sendNotification(title: string, message: string): void {
  if (process.platform !== 'darwin') return;

  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
  execFile('osascript', ['-e', script], (error) => {
    if (error) {
      console.warn('[Notify] Failed to send macOS notification:', error.message);
    }
  });
}

// ── Launch ────────────────────────────────────────────────────────

main().catch(error => {
  console.error('[Agent] Fatal error:', error);
  process.exit(1);
});
