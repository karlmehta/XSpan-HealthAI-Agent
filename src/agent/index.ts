import cron from 'node-cron';
import { execFile } from 'child_process';
import { loadConfig } from '../config/index.js';
import { LocalStore } from '../storage/local-store.js';
import { XSpanApiClient } from '../sync/xspan-api.js';
import { DataPipeline } from '../sync/data-pipeline.js';
import { startDashboard } from '../dashboard/server.js';

// ── XSpan Health AI Agent — Main Daemon ─────────────────────────
//
// PRIVACY & HIPAA COMPLIANCE:
// - All raw health data is stored locally in encrypted SQLite
// - Only synthesized biomarker vectors are sent to XSpan cloud
// - All health queries are processed by XSpan's HIPAA-compliant H-LLM
// - Health data is NEVER exposed to third-party AI tools (Claude, GPT, etc.)
// - No MCP server — health data stays within XSpan's secure perimeter
//

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  XSpan HealthAI Agent v1.0.0              ║');
  console.log('║  HIPAA-compliant health intelligence      ║');
  console.log('╚═══════════════════════════════════════════╝');

  // Load configuration
  const config = loadConfig();
  console.log('[Agent] Configuration loaded');

  // Initialize local store
  const store = new LocalStore(config.storage.dataDir);
  console.log(`[Agent] Encrypted SQLite store initialized at ${config.storage.dataDir}/xspan.db`);

  // Create API client (with subscription gate)
  const apiClient = new XSpanApiClient(config);
  const connected = await apiClient.checkConnectivity();
  if (connected) {
    console.log('[Agent] XSpan Cloud API connected (HIPAA-compliant endpoint)');

    // Check subscription status
    const status = await apiClient.subscription.checkSubscription();
    if (status.tier === 'pro' && status.active) {
      console.log('[Agent] Subscription: XSpan Pro (active)');
    } else {
      console.log('[Agent] Subscription: Free tier');
      console.log('[Agent] Upgrade to Pro ($20/mo) for AI nudges, Health Passport, and risk scores');
      console.log('[Agent] Visit: https://xspan.ai/agent#pricing');
    }
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

  // Health data sync (every N minutes) — FREE
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

  // Morning nudges — PRO ONLY
  cron.schedule(config.schedules.nudgeMorning, async () => {
    await fetchAndDeliverNudges(store, apiClient, config.notifications.enabled, 'morning');
  });

  // Midday nudges — PRO ONLY
  cron.schedule(config.schedules.nudgeMidday, async () => {
    await fetchAndDeliverNudges(store, apiClient, config.notifications.enabled, 'midday');
  });

  // Evening nudges — PRO ONLY
  cron.schedule(config.schedules.nudgeEvening, async () => {
    await fetchAndDeliverNudges(store, apiClient, config.notifications.enabled, 'evening');
  });
  console.log('[Agent] Nudge schedule configured (3x daily — requires Pro)');

  // Cloud sync (every N minutes — synthesize biomarkers and push to XSpan) — PRO ONLY
  const cloudInterval = config.schedules.cloudSyncIntervalMinutes;
  cron.schedule(`*/${cloudInterval} * * * *`, async () => {
    console.log('[Cron] Running cloud sync...');
    try {
      const vector = await pipeline.synthesizeBiomarkers(store);
      const response = await apiClient.syncBiomarkers(vector);
      if (response) {
        console.log(`[Cron] Cloud sync complete — twin updated: ${response.digitalTwinUpdated}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'SubscriptionRequiredError') {
        console.log('[Cron] Cloud sync requires Pro subscription — data saved locally');
      } else {
        console.error('[Cron] Cloud sync failed:', error);
      }
    }
  });
  console.log(`[Agent] Cloud sync scheduled every ${cloudInterval} minutes`);

  // Weekly Health Passport generation — PRO ONLY
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
            `Overall Score: ${passport.overallScore}/100. View at xspan.ai/passport`,
          );
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'SubscriptionRequiredError') {
        console.log('[Cron] Health Passport requires Pro subscription');
        console.log('[Cron] Subscribe at https://xspan.ai/agent#pricing');
      } else {
        console.error('[Cron] Passport generation failed:', error);
      }
    }
  });
  console.log('[Agent] Weekly passport generation scheduled (requires Pro)');

  // ── Start Dashboard ──────────────────────────────────────────

  startDashboard(config, store, apiClient, pipeline);

  // Open dashboard in browser (cross-platform)
  setTimeout(() => {
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'darwin') {
        execSync('open http://localhost:3000');
      } else if (process.platform === 'win32') {
        execSync('start http://localhost:3000');
      } else {
        execSync('xdg-open http://localhost:3000');
      }
    } catch {}
  }, 1000);

  console.log('');
  console.log('[Agent] Agent is running. Health data syncs locally.');
  console.log('[Agent] Dashboard: http://localhost:3000');
  console.log('[Agent] All health queries go through XSpan HIPAA-compliant H-LLM only.');
  console.log('');

  // ── Graceful Shutdown ───────────────────────────────────────────

  const shutdown = () => {
    console.log('\n[Agent] Shutting down gracefully...');
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process alive
  await new Promise(() => {});
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
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'SubscriptionRequiredError') {
      console.log(`[Cron] Nudges require Pro subscription — visit https://xspan.ai/agent#pricing`);
    } else {
      console.error(`[Cron] ${timeOfDay} nudge fetch failed:`, error);
    }
  }
}

/**
 * Send a desktop notification (cross-platform).
 * macOS: osascript, Windows: PowerShell toast, Linux: notify-send
 */
function sendNotification(title: string, message: string): void {
  const safeTitle = title.replace(/"/g, '\\"');
  const safeMsg = message.replace(/"/g, '\\"');

  if (process.platform === 'darwin') {
    const script = `display notification "${safeMsg}" with title "${safeTitle}"`;
    execFile('osascript', ['-e', script], (error) => {
      if (error) console.warn('[Notify] macOS notification failed:', error.message);
    });
  } else if (process.platform === 'win32') {
    const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $text = $template.GetElementsByTagName('text'); $text.Item(0).AppendChild($template.CreateTextNode('${safeTitle}')); $text.Item(1).AppendChild($template.CreateTextNode('${safeMsg}')); $toast = [Windows.UI.Notifications.ToastNotification]::new($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('XSpan HealthAI').Show($toast)`;
    execFile('powershell', ['-Command', ps], (error) => {
      if (error) console.warn('[Notify] Windows notification failed:', error.message);
    });
  } else {
    execFile('notify-send', [title, message], (error) => {
      if (error) console.warn('[Notify] Linux notification failed:', error.message);
    });
  }
}

// ── Launch ────────────────────────────────────────────────────────

main().catch(error => {
  console.error('[Agent] Fatal error:', error);
  process.exit(1);
});
