import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { LocalStore } from '../storage/local-store.js';
import type { XSpanApiClient } from '../sync/xspan-api.js';
import { SubscriptionRequiredError } from '../sync/xspan-api.js';
import type { DataPipeline } from '../sync/data-pipeline.js';

// ── MCP Server ────────────────────────────────────────────────

export function createMcpServer(
  store: LocalStore,
  apiClient: XSpanApiClient,
  pipeline: DataPipeline,
) {
  const server = new Server(
    { name: 'xspan-health-agent', version: '1.0.0' },
    {
      capabilities: { tools: {} },
    }
  );

  // ── List Tools ──────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'xspan_get_health_summary',
        description: "Get a summary of the user's health metrics for today or a specific date",
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'ISO date (YYYY-MM-DD), defaults to today' },
          },
        },
      },
      {
        name: 'xspan_get_biomarkers',
        description: 'Get the latest biomarker readings including labs, vitals, and derived scores',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['cardiovascular', 'metabolic', 'sleep', 'activity', 'nutrition', 'labs', 'all'],
              description: 'Filter by biomarker category',
            },
            days: { type: 'number', description: 'Number of days of history (default: 7)' },
          },
        },
      },
      {
        name: 'xspan_get_digital_twin',
        description: "Get the user's complete Digital Twin health profile",
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'xspan_log_nutrition',
        description: 'Log a meal or food item. Accepts natural language descriptions.',
        inputSchema: {
          type: 'object',
          required: ['description'],
          properties: {
            description: {
              type: 'string',
              description: 'e.g. "grilled salmon with asparagus and brown rice"',
            },
            meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
            time: { type: 'string', description: 'ISO datetime, defaults to now' },
          },
        },
      },
      {
        name: 'xspan_get_nudges',
        description: "Get today's personalized health nudges from XSpan",
        inputSchema: {
          type: 'object',
          properties: {
            unread_only: { type: 'boolean', description: 'Only return unacknowledged nudges' },
          },
        },
      },
      {
        name: 'xspan_get_health_passport',
        description: 'Get the latest weekly Health Passport summary',
        inputSchema: {
          type: 'object',
          properties: {
            week_ending: { type: 'string', description: 'ISO date for week ending (defaults to latest)' },
          },
        },
      },
      {
        name: 'xspan_get_risk_scores',
        description: 'Get predictive health risk scores across multiple disease categories',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'xspan_ask_health',
        description: "Ask a natural language question about the user's health, powered by XSpan H-LLM",
        inputSchema: {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string', description: 'Health question in natural language' },
          },
        },
      },
      {
        name: 'xspan_sync_apple_health',
        description: 'Manually trigger an Apple Health data sync',
        inputSchema: {
          type: 'object',
          properties: {
            hours: { type: 'number', description: 'Hours of data to sync (default: 24)' },
          },
        },
      },
      {
        name: 'xspan_sync_ehr',
        description: 'Manually trigger an EHR data sync',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));

  // ── Call Tool ───────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'xspan_get_health_summary':
          return await handleGetHealthSummary(store, args as { date?: string });

        case 'xspan_get_biomarkers':
          return await handleGetBiomarkers(store, args as { category?: string; days?: number });

        case 'xspan_get_digital_twin':
          return await handleGetDigitalTwin(store, pipeline);

        case 'xspan_log_nutrition':
          return await handleLogNutrition(store, apiClient, args as {
            description: string;
            meal_type?: string;
            time?: string;
          });

        case 'xspan_get_nudges':
          return await handleGetNudges(store, args as { unread_only?: boolean });

        case 'xspan_get_health_passport':
          return await handleGetHealthPassport(store, apiClient, args as { week_ending?: string });

        case 'xspan_get_risk_scores':
          return await handleGetRiskScores(apiClient);

        case 'xspan_ask_health':
          return await handleAskHealth(store, apiClient, pipeline, args as { question: string });

        case 'xspan_sync_apple_health':
          return await handleSyncAppleHealth(store, pipeline, args as { hours?: number });

        case 'xspan_sync_ehr':
          return await handleSyncEhr(store, pipeline);

        default:
          return errorResponse(`Unknown tool: ${name}`);
      }
    } catch (error) {
      // If subscription required, return the upgrade message (not a generic error)
      if (error instanceof SubscriptionRequiredError) {
        return {
          content: [{ type: 'text' as const, text: error.message }],
          isError: false, // Not an error — it's a subscription prompt
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(`Tool execution failed: ${message}`);
    }
  });

  return server;
}

// ── Tool Handlers ─────────────────────────────────────────────

async function handleGetHealthSummary(store: LocalStore, args: { date?: string }) {
  const date = args.date ? new Date(args.date) : new Date();
  const dateStr = date.toISOString().split('T')[0]!;
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);

  const steps = store.getLatestSample('stepCount');
  const heartRate = store.getLatestSample('heartRate');
  const hrv = store.getLatestSample('heartRateVariabilitySDNN');
  const sleep = store.getSamples({ dataType: 'sleepAnalysis', from, to });
  const calories = store.getLatestSample('activeEnergyBurned');
  const snapshot = store.getLatestSnapshot();

  const summary = {
    date: dateStr,
    metrics: {
      steps: steps?.value ?? null,
      heartRate: heartRate ? { value: heartRate.value, unit: heartRate.unit } : null,
      hrv: hrv ? { value: hrv.value, unit: 'ms' } : null,
      activeCalories: calories?.value ?? null,
      sleepMinutes: sleep.reduce((acc, s) => acc + s.value, 0) || null,
    },
    overallScore: snapshot?.biomarkers.recoveryScore ?? null,
    dataCompleteness: snapshot?.biomarkers.dataCompleteness ?? 0,
    lastUpdated: snapshot?.createdAt.toISOString() ?? null,
  };

  return jsonResponse(summary);
}

async function handleGetBiomarkers(
  store: LocalStore,
  args: { category?: string; days?: number },
) {
  const days = args.days ?? 7;
  const snapshots = store.getSnapshots(days);
  const latest = snapshots[0];

  if (!latest) {
    return jsonResponse({ message: 'No biomarker data available. Run a sync first.', snapshots: [] });
  }

  const bm = latest.biomarkers;
  let filtered: Record<string, unknown> = {};

  switch (args.category) {
    case 'cardiovascular':
      filtered = {
        restingHeartRate: bm.restingHeartRate,
        heartRateVariability: bm.heartRateVariability,
        bloodPressureSystolic: bm.bloodPressureSystolic,
        bloodPressureDiastolic: bm.bloodPressureDiastolic,
        vo2Max: bm.vo2Max,
        cardiovascularRisk: bm.cardiovascularRisk,
      };
      break;
    case 'metabolic':
      filtered = {
        bloodGlucoseFasting: bm.bloodGlucoseFasting,
        bodyMassIndex: bm.bodyMassIndex,
        bodyFatPercentage: bm.bodyFatPercentage,
        hba1c: bm.hba1c,
        ldlCholesterol: bm.ldlCholesterol,
        hdlCholesterol: bm.hdlCholesterol,
        metabolicRisk: bm.metabolicRisk,
      };
      break;
    case 'sleep':
      filtered = {
        totalSleepMinutes: bm.totalSleepMinutes,
        deepSleepMinutes: bm.deepSleepMinutes,
        remSleepMinutes: bm.remSleepMinutes,
        sleepEfficiency: bm.sleepEfficiency,
        sleepOnsetLatency: bm.sleepOnsetLatency,
        sleepDisorderRisk: bm.sleepDisorderRisk,
      };
      break;
    case 'activity':
      filtered = {
        dailySteps: bm.dailySteps,
        activeMinutes: bm.activeMinutes,
        activeCalories: bm.activeCalories,
        exerciseSessionsPerWeek: bm.exerciseSessionsPerWeek,
      };
      break;
    case 'nutrition':
      filtered = {
        avgDailyCalories: bm.avgDailyCalories,
        avgProteinGrams: bm.avgProteinGrams,
        avgCarbGrams: bm.avgCarbGrams,
        avgFatGrams: bm.avgFatGrams,
        avgFiberGrams: bm.avgFiberGrams,
      };
      break;
    case 'labs':
      filtered = {
        hba1c: bm.hba1c, ldlCholesterol: bm.ldlCholesterol,
        hdlCholesterol: bm.hdlCholesterol, triglycerides: bm.triglycerides,
        vitaminD: bm.vitaminD, creatinine: bm.creatinine,
        egfr: bm.egfr, crp: bm.crp,
      };
      break;
    default:
      filtered = bm as unknown as Record<string, unknown>;
  }

  return jsonResponse({
    snapshotDate: latest.snapshotDate,
    category: args.category ?? 'all',
    biomarkers: filtered,
    dataCompleteness: bm.dataCompleteness,
    historyDays: snapshots.length,
  });
}

async function handleGetDigitalTwin(store: LocalStore, pipeline: DataPipeline) {
  const snapshot = store.getLatestSnapshot();
  if (!snapshot) {
    return jsonResponse({ message: 'No Digital Twin data yet. Run a sync first.' });
  }
  return jsonResponse({
    digitalTwin: snapshot.biomarkers,
    snapshotDate: snapshot.snapshotDate,
    version: snapshot.digitalTwinVersion,
    dataCompleteness: snapshot.biomarkers.dataCompleteness,
  });
}

async function handleLogNutrition(
  store: LocalStore,
  apiClient: XSpanApiClient,
  args: { description: string; meal_type?: string; time?: string },
) {
  const entry = await apiClient.parseNutrition(args.description);
  if (!entry) {
    return errorResponse('Could not parse nutrition data. Please check your XSpan connection.');
  }

  entry.mealType = (args.meal_type as 'breakfast' | 'lunch' | 'dinner' | 'snack') ?? entry.mealType;
  if (args.time) entry.loggedAt = new Date(args.time);

  store.insertNutritionEntry(entry);

  const today = new Date();
  const todayEntries = store.getNutritionEntries(
    new Date(today.setHours(0, 0, 0, 0)),
    new Date(today.setHours(23, 59, 59, 999))
  );
  const dailyTotal = todayEntries.reduce((acc, e) => ({
    calories: acc.calories + e.nutrients.calories,
    protein: acc.protein + e.nutrients.protein,
    carbs: acc.carbs + e.nutrients.carbs,
    fat: acc.fat + e.nutrients.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  return jsonResponse({ logged: entry, dailyTotal, mealsToday: todayEntries.length });
}

async function handleGetNudges(store: LocalStore, args: { unread_only?: boolean }) {
  const nudges = args.unread_only
    ? store.getUnacknowledgedNudges()
    : store.getTodayNudges();

  return jsonResponse({
    nudges,
    count: nudges.length,
    date: new Date().toISOString().split('T')[0],
  });
}

async function handleGetHealthPassport(
  store: LocalStore,
  apiClient: XSpanApiClient,
  args: { week_ending?: string },
) {
  let passport = store.getLatestPassport();

  if (!passport || args.week_ending) {
    passport = await apiClient.getHealthPassport(args.week_ending);
    if (passport) store.insertPassport(passport);
  }

  if (!passport) {
    return jsonResponse({ message: 'No Health Passport available yet. One will be generated this Sunday.' });
  }

  return jsonResponse(passport);
}

async function handleGetRiskScores(apiClient: XSpanApiClient) {
  const scores = await apiClient.getRiskScores();
  return jsonResponse({ riskScores: scores, count: scores.length });
}

async function handleAskHealth(
  store: LocalStore,
  apiClient: XSpanApiClient,
  pipeline: DataPipeline,
  args: { question: string },
) {
  const snapshot = store.getLatestSnapshot();
  const answer = await apiClient.askHealth(args.question, snapshot?.biomarkers);

  if (!answer) {
    return errorResponse('Could not get an answer. Please check your XSpan connection.');
  }

  return jsonResponse(answer);
}

async function handleSyncAppleHealth(
  store: LocalStore,
  pipeline: DataPipeline,
  args: { hours?: number },
) {
  const result = await pipeline.syncAppleHealth(store, args.hours ?? 24);
  return jsonResponse({ message: `Synced ${result} new Apple Health records`, newRecords: result });
}

async function handleSyncEhr(store: LocalStore, pipeline: DataPipeline) {
  const result = await pipeline.syncEhr(store);
  return jsonResponse({ message: `Synced ${result} new EHR records`, newRecords: result });
}

// ── Response Helpers ──────────────────────────────────────────

function jsonResponse(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ── MCP Entry Point ───────────────────────────────────────────

export async function startMcpServer(
  store: LocalStore,
  apiClient: XSpanApiClient,
  pipeline: DataPipeline,
) {
  const server = createMcpServer(store, apiClient, pipeline);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[XSpan MCP] Server started on stdio transport');
}
