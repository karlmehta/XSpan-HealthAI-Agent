#!/usr/bin/env node
// ============================================================
// Entry point for @myhealthspan/agent
// Routes: mhs status | mhs serve | mhs mcp | mhs help
// ============================================================

import { argv } from 'process';

const command = argv[2] || 'status';

if (command === 'serve') {
  // Start web dashboard on port 3000
  import('./dashboard/server.js').then((m) => m.startDashboard());
} else if (command === 'mcp') {
  // Start MCP server (stdio transport for Claude Desktop / Cursor)
  import('./mcp-server.js');
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
  MyHealthSpan Agent v1.0.0
  Personal health intelligence — wearables + medical records + labs

  Usage:
    mhs                  Show health status dashboard (default)
    mhs status           Show health status dashboard
    mhs serve            Start web dashboard on http://localhost:3000
    mhs mcp              Start MCP server (stdio transport)
    mhs help             Show this help message

  Environment:
    XSPAN_API_KEY        Your XSpan API key (get one at https://xspan.ai/signup)
    MHS_DATA_DIR         Data directory (default: ~/.myhealthspan)
    MHS_PORT             Dashboard port (default: 3000)

  MCP Configuration (Claude Desktop / Cursor):
    See mcp-config.json or run: mhs mcp --print-config

  More info: https://xspan.ai/agent
  `);
} else {
  // All other commands go to the CLI handler (status, sync, labs, etc.)
  import('./mhs.js');
}
