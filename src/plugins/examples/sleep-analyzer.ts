// ============================================================
// XSpan AI Agent — Example Analyzer Plugin: Sleep Quality
// ============================================================
//
// This is a STUB demonstrating how to build an analyzer plugin
// that processes biomarker snapshots and produces sleep quality
// insights. In production, you would add more sophisticated
// analysis (e.g., trend detection, consistency scoring,
// circadian rhythm assessment).
//
// ## How analyzer plugins work
//
//   1. Implement the Plugin interface with type = 'analyzer'.
//   2. In `init()`, perform any setup (load models, validate
//      config, etc.).
//   3. In `execute(context)`, read `context.snapshots`, run
//      your analysis, and return an `AnalyzerResult`.
//
// ## Usage
//
//   import { createSleepAnalyzerPlugin } from './plugins/examples/sleep-analyzer';
//
//   const sleepAnalyzer = createSleepAnalyzerPlugin();
//   const manager = new PluginManager();
//   await manager.register(sleepAnalyzer);
//   const results = await manager.executeAnalyzers(snapshots);
//
// ============================================================

import { BiomarkerSnapshot } from '../../types/index';
import { Plugin, PluginContext, AnalyzerResult } from '../index';

// ── Configuration ───────────────────────────────────────────

export interface SleepAnalyzerConfig {
  /** Number of recent days to analyze. Default: 7 */
  windowDays?: number;
  /** Minimum deep sleep minutes considered healthy. Default: 60 */
  minDeepSleepMinutes?: number;
  /** Minimum total sleep minutes considered healthy. Default: 420 (7 hours) */
  minTotalSleepMinutes?: number;
  /** Minimum sleep efficiency considered healthy. Default: 85% */
  minSleepEfficiency?: number;
}

// ── Plugin Implementation ───────────────────────────────────

/**
 * Factory function that creates a sleep quality analyzer plugin.
 *
 * @param config - Optional configuration overrides
 * @returns A Plugin that analyzes sleep patterns and returns insights
 */
export function createSleepAnalyzerPlugin(
  config: SleepAnalyzerConfig = {},
): Plugin<AnalyzerResult> {
  const _windowDays = config.windowDays ?? 7;
  const _minDeep = config.minDeepSleepMinutes ?? 60;
  const _minTotal = config.minTotalSleepMinutes ?? 420;
  const _minEfficiency = config.minSleepEfficiency ?? 85;

  return {
    name: 'sleep-analyzer',
    version: '1.0.0',
    type: 'analyzer',

    async init(): Promise<void> {
      // Analyzer plugins typically need minimal setup.
      // In production, you might:
      // - Load a pre-trained model for sleep stage classification
      // - Validate configuration thresholds
      // - Set up connections to reference databases
      console.log('[sleep-analyzer] Initialized successfully');
    },

    async execute(context: PluginContext): Promise<AnalyzerResult> {
      const insights: string[] = [];
      const scores: Record<string, number> = {};

      // Filter to the analysis window
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - _windowDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const recentSnapshots = context.snapshots
        .filter((s) => s.snapshotDate >= cutoffStr)
        .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

      if (recentSnapshots.length === 0) {
        return {
          pluginName: 'sleep-analyzer',
          insights: ['Insufficient sleep data for analysis'],
          scores: { sleepQuality: 0 },
        };
      }

      // ── Compute averages ──────────────────────────────
      const avgTotal = _average(recentSnapshots, 'totalSleepMinutes');
      const avgDeep = _average(recentSnapshots, 'deepSleepMinutes');
      const avgREM = _average(recentSnapshots, 'remSleepMinutes');
      const avgEfficiency = _average(recentSnapshots, 'sleepEfficiency');

      // ── Sleep Quality Score (0-100) ───────────────────
      // Weighted composite of duration, depth, and efficiency
      let qualityScore = 0;
      if (avgTotal !== null) {
        const durationScore = Math.min(100, (avgTotal / _minTotal) * 100);
        qualityScore += durationScore * 0.35;
      }
      if (avgDeep !== null) {
        const deepScore = Math.min(100, (avgDeep / _minDeep) * 100);
        qualityScore += deepScore * 0.30;
      }
      if (avgEfficiency !== null) {
        const effScore = Math.min(100, (avgEfficiency / _minEfficiency) * 100);
        qualityScore += effScore * 0.35;
      }
      scores.sleepQuality = Math.round(qualityScore);

      // ── Generate insights ─────────────────────────────

      // Duration insight
      if (avgTotal !== null) {
        const hours = (avgTotal / 60).toFixed(1);
        if (avgTotal < _minTotal) {
          insights.push(
            `Average sleep duration is ${hours} hours, below the ${(_minTotal / 60).toFixed(0)}-hour target. Aim for an earlier bedtime.`,
          );
        } else {
          insights.push(
            `Average sleep duration is ${hours} hours — meeting your target.`,
          );
        }
      }

      // Deep sleep insight
      if (avgDeep !== null) {
        if (avgDeep < _minDeep) {
          insights.push(
            `Deep sleep averaging ${Math.round(avgDeep)} minutes, below the ${_minDeep}-minute target. Consider reducing alcohol and late-night screen time.`,
          );
        } else {
          insights.push(
            `Deep sleep is healthy at ${Math.round(avgDeep)} minutes per night.`,
          );
        }
      }

      // Efficiency insight
      if (avgEfficiency !== null) {
        if (avgEfficiency < _minEfficiency) {
          insights.push(
            `Sleep efficiency is ${avgEfficiency.toFixed(1)}%, below the ${_minEfficiency}% target. You may be spending too much awake time in bed.`,
          );
        }
      }

      // Consistency insight (check variance in total sleep)
      if (recentSnapshots.length >= 3) {
        const totals = recentSnapshots
          .map((s) => s.biomarkers.totalSleepMinutes)
          .filter((v): v is number => typeof v === 'number');

        if (totals.length >= 3) {
          const stdDev = _standardDeviation(totals);
          scores.sleepConsistency = Math.max(0, Math.round(100 - stdDev));

          if (stdDev > 45) {
            insights.push(
              'Sleep duration varies significantly from night to night. A consistent schedule can improve overall sleep quality.',
            );
          } else if (stdDev < 20) {
            insights.push(
              'Sleep schedule is very consistent — this supports healthy circadian rhythm.',
            );
          }
        }
      }

      // REM insight
      if (avgREM !== null) {
        scores.remSleepMinutes = Math.round(avgREM);
        if (avgREM < 60) {
          insights.push(
            `REM sleep averaging ${Math.round(avgREM)} minutes. Stress and alcohol can reduce REM — consider relaxation techniques before bed.`,
          );
        }
      }

      return {
        pluginName: 'sleep-analyzer',
        insights,
        scores,
        metadata: {
          windowDays: _windowDays,
          snapshotsAnalyzed: recentSnapshots.length,
          avgTotalSleepMinutes: avgTotal,
          avgDeepSleepMinutes: avgDeep,
          avgSleepEfficiency: avgEfficiency,
        },
      };
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────

function _average(
  snapshots: BiomarkerSnapshot[],
  field: 'totalSleepMinutes' | 'deepSleepMinutes' | 'remSleepMinutes' | 'sleepEfficiency',
): number | null {
  let sum = 0;
  let count = 0;
  for (const s of snapshots) {
    const val = s.biomarkers[field];
    if (typeof val === 'number') {
      sum += val;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

function _standardDeviation(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}
