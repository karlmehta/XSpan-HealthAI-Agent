import cron from 'node-cron';
import { loadConfig } from '../config/index.js';
import { LocalStore } from '../storage/local-store.js';
import { DataPipeline } from '../sync/data-pipeline.js';
import { startDashboard } from '../dashboard/server.js';

// ── XSpan Health AI Agent — Main Daemon ─────────────────────────
//
// LOCAL-ONLY MODE:
// - All health data is stored locally in encrypted SQLite
// - No cloud API calls — zero external server dependencies
// - Data never leaves your machine
// - Cloud features (nudges, passport, risk scores) available only
//   with XSpan Premium via health system invite (not used here)
//

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  MyHealthSpan Agent v1.0.0                ║');
  console.log('║  Own your health data. Get insights.      ║');
  console.log('╚═══════════════════════════════════════════╝');

  // Load configuration
  const config = loadConfig();
  console.log('[Agent] Configuration loaded (local-only mode)');

  // Initialize local store
  const store = new LocalStore(config.storage.dataDir);
  console.log(`[Agent] Encrypted SQLite store initialized at ${config.storage.dataDir}/xspan.db`);

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

  // ── Start Dashboard ──────────────────────────────────────────

  startDashboard(config, store, pipeline);

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
  console.log('[Agent] Agent is running. All data stays local — zero cloud dependencies.');
  console.log('[Agent] Dashboard: http://localhost:3000');
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

// ── Launch ────────────────────────────────────────────────────────

main().catch(error => {
  console.error('[Agent] Fatal error:', error);
  process.exit(1);
});
