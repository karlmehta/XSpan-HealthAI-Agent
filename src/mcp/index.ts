import { loadConfig } from '../config/index.js';
import { LocalStore } from '../storage/local-store.js';
import { DataPipeline } from '../sync/data-pipeline.js';
import { startMcpServer } from './server.js';

// ── MCP Standalone Entry Point ──────────────────────────────────
//
// Use this entry point when running the MCP server without the
// full agent daemon (e.g., when launched directly by Claude Desktop).
// Runs entirely locally — no cloud API calls.
//
// Usage:
//   node dist/mcp/index.js
//
// Claude Desktop config (~/.claude/claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "xspan-health": {
//         "command": "node",
//         "args": ["/path/to/xspan-health-agent/dist/mcp/index.js"]
//       }
//     }
//   }

async function main() {
  console.error('[XSpan MCP] Starting standalone MCP server (local-only mode)...');

  const config = loadConfig();
  const store = new LocalStore(config.storage.dataDir);
  const pipeline = new DataPipeline(config);

  // Run a quick sync before serving so the MCP has fresh data
  try {
    const count = await pipeline.syncAll(store);
    if (count > 0) {
      await pipeline.synthesizeBiomarkers(store);
    }
    console.error(`[XSpan MCP] Pre-sync complete: ${count} records`);
  } catch (error) {
    console.error('[XSpan MCP] Pre-sync failed (continuing anyway):', error);
  }

  // No apiClient — MCP runs in local-only mode (cloud features disabled)
  await startMcpServer(store, null, pipeline);

  // Graceful shutdown
  const shutdown = () => {
    console.error('[XSpan MCP] Shutting down...');
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('[XSpan MCP] Fatal error:', error);
  process.exit(1);
});
