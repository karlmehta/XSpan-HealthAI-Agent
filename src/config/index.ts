import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';
import type { AgentConfig } from '../types/index.js';

// Load .env file
loadDotenv();

// ── Validation Schema ─────────────────────────────────────────

const configSchema = z.object({
  // XSpan Cloud (required)
  XSPAN_API_KEY: z.string().min(1, 'XSPAN_API_KEY is required. Get yours at https://xspan.ai/api'),
  XSPAN_USER_ID: z.string().min(1, 'XSPAN_USER_ID is required'),
  XSPAN_API_URL: z.string().url().default('https://api.xspan.ai/v1'),

  // Apple Health
  APPLE_HEALTH_ENABLED: z.string().transform(v => v === 'true').default('true'),

  // Google Health
  GOOGLE_HEALTH_ENABLED: z.string().transform(v => v === 'true').default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_PORT: z.string().transform(Number).default('9876'),

  // EHR
  EHR_ENABLED: z.string().transform(v => v === 'true').default('false'),
  EHR_PROVIDER: z.enum(['epic', 'cerner', 'redox', 'generic_fhir']).optional(),
  EHR_FHIR_BASE_URL: z.string().url().optional(),
  EHR_CLIENT_ID: z.string().optional(),
  EHR_OAUTH_PORT: z.string().transform(Number).default('9877'),

  // Schedules
  NUDGE_MORNING_SCHEDULE: z.string().default('0 8 * * *'),
  NUDGE_MIDDAY_SCHEDULE: z.string().default('0 12 * * *'),
  NUDGE_EVENING_SCHEDULE: z.string().default('0 18 * * *'),
  PASSPORT_SCHEDULE: z.string().default('0 7 * * 0'),
  SYNC_INTERVAL_MINUTES: z.string().transform(Number).default('15'),
  CLOUD_SYNC_INTERVAL_MINUTES: z.string().transform(Number).default('60'),

  // Storage
  DATA_DIR: z.string().default(join(homedir(), '.xspan', 'data')),
  PASSPORT_DIR: z.string().default(join(homedir(), '.xspan', 'passports')),

  // Notifications
  NOTIFICATIONS_ENABLED: z.string().transform(v => v === 'true').default('true'),
  NUDGE_WEBHOOK_URL: z.string().url().optional(),

  // HIPAA: Health data is NEVER exposed to third-party AI tools
  // All health queries go through XSpan's HIPAA-compliant H-LLM only
});

// ── Config Loader ─────────────────────────────────────────────

function loadConfig(): AgentConfig {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map(issue => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `\n❌ XSpan Agent configuration error:\n\n${errors}\n\n` +
      `Copy .env.example to .env and fill in the required values.\n` +
      `Run: cp .env.example .env`
    );
  }

  const env = result.data;

  return {
    xspan: {
      apiKey: env.XSPAN_API_KEY,
      userId: env.XSPAN_USER_ID,
      apiUrl: env.XSPAN_API_URL,
    },
    connectors: {
      appleHealth: {
        enabled: env.APPLE_HEALTH_ENABLED && process.platform === 'darwin',
      },
      googleHealth: {
        enabled: env.GOOGLE_HEALTH_ENABLED,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        oauthPort: env.GOOGLE_OAUTH_PORT,
      },
      ehr: {
        enabled: env.EHR_ENABLED,
        provider: env.EHR_PROVIDER,
        fhirBaseUrl: env.EHR_FHIR_BASE_URL,
        clientId: env.EHR_CLIENT_ID,
        oauthPort: env.EHR_OAUTH_PORT,
      },
    },
    schedules: {
      nudgeMorning: env.NUDGE_MORNING_SCHEDULE,
      nudgeMidday: env.NUDGE_MIDDAY_SCHEDULE,
      nudgeEvening: env.NUDGE_EVENING_SCHEDULE,
      passportGeneration: env.PASSPORT_SCHEDULE,
      syncIntervalMinutes: env.SYNC_INTERVAL_MINUTES,
      cloudSyncIntervalMinutes: env.CLOUD_SYNC_INTERVAL_MINUTES,
    },
    storage: {
      dataDir: env.DATA_DIR,
      passportDir: env.PASSPORT_DIR,
    },
    notifications: {
      enabled: env.NOTIFICATIONS_ENABLED,
      webhookUrl: env.NUDGE_WEBHOOK_URL,
    },
  };
}

export { loadConfig };
export type { AgentConfig };
