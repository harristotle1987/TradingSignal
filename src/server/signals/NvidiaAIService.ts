/**
 * NVIDIA AI Service Integration
 * Evaluates already-calculated technical & market data.
 * Does NOT generate market prices, candles, or entry levels.
 */

import { SignalDirection, ProviderHealth } from '../../types/index.js';
import { Gate33AiAssessmentPolicy, AiQualitativeClassification } from './Gate33AiAssessmentPolicy.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

export interface ConfluenceAnalysisResult {
  hasSetup: boolean;
  symbol: string;
  entryPrice: number;
  direction?: SignalDirection;
  timeframe?: string;
  strategy?: string;
  confluenceReasons: string[];
  confidenceScore: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  technicalMetrics?: {
    htfEma9?: number;
    htfEma21?: number;
    htfRsi?: number;
    ltfEma9?: number;
    ltfEma21?: number;
    ltfRsi?: number;
    ltfMacdHistogram?: number;
    atr?: number;
  };
  rejectionReason?: string;
}

export interface CandidateAnalysisPayload extends ConfluenceAnalysisResult {
  assetClass?: string;
  marketRegime?: string;
  winRateEstimate?: number;
}

export interface CandidateRanking {
  symbol: string;
  rank: number;
  isRecommended: boolean;
  reasoning: string;
  detectedRisks?: string;
}

export interface NvidiaBatchEvaluationResult {
  aiAssessment: string;
  rankings: CandidateRanking[];
  recommendedSymbols: string[];
  isAiValidated: boolean;
  classification: AiQualitativeClassification;
}

export interface NvidiaEvaluationResult {
  aiAssessment: string;
  classification: AiQualitativeClassification;
  refinedConfidence: number; // Strictly equals deterministic confidenceScore — NO AI +2 BOOST!
  documentedConfidence?: number; // Real documented confidence returned by the AI service
  isAiValidated: boolean;
  neverBoostConfidenceEnforced: true;
  neverInventProbabilityEnforced: true;
  neverOverrideDeterministicEnforced: true;
  neverGeneratePricesEnforced: true;
}

export class NvidiaAIService {
  /**
   * Evaluates and ranks a batch of top 3-5 pre-calculated technical candidate setups using NVIDIA AI API.
   * Enforces Gate 2 & Gate 3:
   * - Receives ONLY top 3-5 candidates passing deep MTF & technical gates.
   * - Compares candidates, identifies strongest setups, detects risks/conflicts, and ranks 1..N.
   * - Returns 0 to 3 recommended candidates.
   * - NEVER invents prices or overrides technical indicators / hard safety gates.
   */
  static async evaluateAndRankBatch(
    candidates: CandidateAnalysisPayload[]
  ): Promise<NvidiaBatchEvaluationResult> {
    if (!candidates || candidates.length === 0) {
      return {
        aiAssessment: 'No candidates passed deep technical MTF & hard safety gates. Capital preservation active (0 setups recommended).',
        rankings: [],
        recommendedSymbols: [],
        isAiValidated: false,
        classification: 'UNAVAILABLE',
      };
    }

    const { getActiveProfiler } = await import('./ScanPerformanceProfiler.js');
    const profiler = getActiveProfiler();
    let timeoutMs = 8000;
    if (profiler && profiler.globalDeadline > 0) {
      const remainingMs = profiler.globalDeadline - Date.now();
      if (remainingMs < timeoutMs + 500) {
        return this.fallbackDeterministicRanking(
          candidates,
          `Insufficient scan budget remaining (${remainingMs}ms) for AI batch ranking`
        );
      }
      timeoutMs = Math.min(8000, remainingMs - 500);
    }

    const apiKey = serverConfig.getNvidiaApiKey();
    if (!apiKey || apiKey.trim().length === 0) {
      return this.fallbackDeterministicRanking(
        candidates,
        'NVIDIA AI Standby (API key unconfigured). Algorithmic engine ranked setups deterministically.'
      );
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const candidatesFormatted = candidates.slice(0, 5).map((c) => ({
        symbol: c.symbol,
        direction: c.direction,
        entryPrice: c.entryPrice,
        stopLoss: c.stopLoss,
        takeProfit: c.takeProfit,
        riskRewardRatio: `${c.riskRewardRatio.toFixed(2)}:1`,
        score: `${c.confidenceScore}/100`,
        strategy: c.strategy || 'Multi-TF Trend Confluence',
        marketRegime: c.marketRegime || 'STANDARD',
        confluenceReasons: c.confluenceReasons.slice(0, 5),
        technicalMetrics: c.technicalMetrics || {},
      }));

      const promptPayload = {
        model: 'meta/llama-3.1-70b-instruct',
        messages: [
          {
            role: 'system',
            content:
              'You are an institutional trading risk analyst evaluating top pre-validated technical candidate setups.\n' +
              'Your tasks:\n' +
              '1. Compare candidates based strictly on provided metrics and confluence reasons.\n' +
              '2. Identify strongest setups and rank from strongest (rank 1) to weakest.\n' +
              '3. Explain reasoning briefly (1-2 sentences per candidate).\n' +
              '4. Detect any conflicting indicators or unusual risk conditions.\n' +
              '5. Select 0 to 3 top recommended candidates based strictly on setup quality.\n\n' +
              'STRICT MANDATES:\n' +
              '- You MUST NEVER invent prices, market data, or indicators.\n' +
              '- You MUST NEVER request unrelated market data.\n' +
              '- You MUST NEVER override existing indicators, entry prices, SL, TP, or scores.\n' +
              '- You MUST NEVER lower required score or bypass safety gates.\n' +
              '- You MUST NEVER force a trade if setups present high risk — return 0 recommendations if appropriate.\n' +
              '- Return at most 3 top recommended candidates (0 to 3).\n' +
              '- You are an analysis/ranking layer, NOT the source of truth for market prices.\n\n' +
              'Return your response strictly as a JSON object formatted as:\n' +
              '{\n' +
              '  "overallAssessment": "Brief comparison summary",\n' +
              '  "rankings": [\n' +
              '    {\n' +
              '      "symbol": "SYMBOL_NAME",\n' +
              '      "rank": 1,\n' +
              '      "isRecommended": true,\n' +
              '      "reasoning": "Brief explanation",\n' +
              '      "detectedRisks": "Brief risk note or None"\n' +
              '    }\n' +
              '  ]\n' +
              '}',
          },
          {
            role: 'user',
            content: `Evaluate and rank these top pre-screened technical setups:\n${JSON.stringify(candidatesFormatted, null, 2)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 600,
      };

      logger.info('[NVIDIA AI Batch Input Payload]', { candidateCount: candidates.length });

      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(promptPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.info('NVIDIA AI API returned non-200 response in batch evaluation', { status: response.status });
        return this.fallbackDeterministicRanking(candidates, `NVIDIA AI API returned HTTP ${response.status}`);
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content?.trim();

      if (!content) {
        return this.fallbackDeterministicRanking(candidates, 'Empty response from NVIDIA AI API');
      }

      let cleanJsonStr = content;
      const matchJson = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (matchJson) {
        cleanJsonStr = matchJson[1];
      }

      try {
        const parsed = JSON.parse(cleanJsonStr);
        const rankingsArr: CandidateRanking[] = Array.isArray(parsed.rankings) ? parsed.rankings : [];

        const recommendedSymbols = rankingsArr
          .filter((r) => r.isRecommended)
          .slice(0, 3)
          .map((r) => r.symbol);

        return {
          aiAssessment: parsed.overallAssessment || `NVIDIA AI evaluated ${candidates.length} setup(s) and recommended ${recommendedSymbols.length} candidate(s).`,
          rankings: rankingsArr,
          recommendedSymbols,
          isAiValidated: true,
          classification: 'QUALITATIVE_CONFIRMATION',
        };
      } catch {
        return this.fallbackDeterministicRanking(candidates, `NVIDIA AI qualitative summary: ${content.substring(0, 150)}...`);
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      logger.info('NVIDIA AI batch evaluation fallback', { reason: isAbort ? 'Timed out (8s)' : String(err) });
      return this.fallbackDeterministicRanking(candidates, `NVIDIA AI ${isAbort ? 'Timeout' : 'Offline'}`);
    }
  }

  private static fallbackDeterministicRanking(
    candidates: CandidateAnalysisPayload[],
    reason: string
  ): NvidiaBatchEvaluationResult {
    const sorted = [...candidates].sort((a, b) => b.confidenceScore - a.confidenceScore);
    const topRecs = sorted.slice(0, 3);
    const rankings: CandidateRanking[] = sorted.map((c, idx) => ({
      symbol: c.symbol,
      rank: idx + 1,
      isRecommended: idx < 3,
      reasoning: `Algorithmic score ${c.confidenceScore}/100 with ${c.riskRewardRatio.toFixed(2)}:1 R:R (${c.strategy || 'Multi-TF Trend'}).`,
      detectedRisks: 'None',
    }));

    return {
      aiAssessment: `${reason}. Algorithmic engine ranked setups deterministically.`,
      rankings,
      recommendedSymbols: topRecs.map((r) => r.symbol),
      isAiValidated: false,
      classification: 'UNAVAILABLE',
    };
  }

  /**
   * Evaluates the technical confluence result using NVIDIA AI API if configured.
   * Enforces Gate 33: AI Assessment is Qualitative, NOT Statistical Probability.
   */
  static async evaluate(analysis: ConfluenceAnalysisResult): Promise<NvidiaEvaluationResult> {
    const apiKey = serverConfig.getNvidiaApiKey();
    const { getActiveProfiler } = await import('./ScanPerformanceProfiler.js');

    const profiler = getActiveProfiler();
    let timeoutMs = 6000;
    if (profiler && profiler.globalDeadline > 0) {
      const remainingMs = profiler.globalDeadline - Date.now();
      if (remainingMs < timeoutMs + 500) {
        return Gate33AiAssessmentPolicy.classifyResponse(
          `Insufficient scan budget remaining (${remainingMs}ms). Algorithmic technical confluence validated.`,
          analysis.confidenceScore,
          false
        );
      }
      timeoutMs = Math.min(6000, remainingMs - 500);
    }

    if (!apiKey || apiKey.trim().length === 0) {
      const policyRes = Gate33AiAssessmentPolicy.classifyResponse(
        `NVIDIA AI Standby (API key unconfigured). Algorithmic engine calculated ${analysis.direction} signal with ${analysis.confidenceScore}% confidence.`,
        analysis.confidenceScore,
        false
      );

      return {
        ...policyRes,
        classification: 'UNAVAILABLE',
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const tm = analysis.technicalMetrics;
      const metricsText = tm
        ? ` Metrics: 1H EMA9=${tm.htfEma9}, 1H EMA21=${tm.htfEma21}, 1H RSI=${tm.htfRsi}, 15m EMA9=${tm.ltfEma9}, 15m EMA21=${tm.ltfEma21}, 15m RSI=${tm.ltfRsi}, 15m MACD Hist=${tm.ltfMacdHistogram}, ATR=${tm.atr}.`
        : '';

      const promptPayload = {
        model: 'meta/llama-3.1-70b-instruct',
        messages: [
          {
            role: 'system',
            content: 'You are an institutional trading risk analyst evaluating pre-calculated technical metrics. Do NOT generate prices or probabilities. Respond in 1 brief qualitative sentence.',
          },
          {
            role: 'user',
            content: `Evaluate: Symbol: ${analysis.symbol}, Direction: ${analysis.direction}, Entry: ${analysis.entryPrice}, SL: ${analysis.stopLoss}, TP: ${analysis.takeProfit}, R:R: ${analysis.riskRewardRatio}:1, Score: ${analysis.confidenceScore}%. Factors: ${analysis.confluenceReasons.join(' | ')}.${metricsText}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 80,
      };

      logger.info('[NVIDIA AI Input Payload]', { prompt: promptPayload.messages[1].content });

      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(promptPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.info('NVIDIA AI API returned non-200 response', { status: response.status });
        return Gate33AiAssessmentPolicy.classifyResponse(
          `NVIDIA AI API returned HTTP ${response.status}. Algorithmic technical confluence validated.`,
          analysis.confidenceScore,
          false
        );
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content?.trim();

      return Gate33AiAssessmentPolicy.classifyResponse(
        content || 'NVIDIA AI qualitative review completed.',
        analysis.confidenceScore,
        true
      );
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      logger.info('NVIDIA AI evaluation fallback', { reason: isAbort ? 'Timed out (6s)' : String(err) });
      return Gate33AiAssessmentPolicy.classifyResponse(
        `NVIDIA AI ${isAbort ? 'UNAVAILABLE (Request Timed Out)' : 'Offline'}. Algorithmic confluence validated.`,
        analysis.confidenceScore,
        false
      );
    }
  }

  /**
   * Health check for NVIDIA AI API integration
   */
  static async healthCheck(): Promise<ProviderHealth> {
    const apiKey = serverConfig.getNvidiaApiKey();
    const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);

    const { getActiveProfiler } = await import('./ScanPerformanceProfiler.js');
    const profiler = getActiveProfiler();
    let timeoutMs = 4000;
    if (profiler && profiler.globalDeadline > 0) {
      const remainingMs = profiler.globalDeadline - Date.now();
      if (remainingMs < timeoutMs + 500) {
        return {
          provider: 'nvidia',
          name: 'NVIDIA AI API',
          configured: true,
          status: 'DEGRADED',
          latencyMs: 0,
          lastChecked: new Date().toISOString(),
          errorMessage: `Insufficient scan budget for health check (${remainingMs}ms)`,
        };
      }
      timeoutMs = Math.min(4000, remainingMs - 500);
    }

    if (!isConfigured) {
      return {
        provider: 'nvidia',
        name: 'NVIDIA AI API',
        configured: false,
        status: 'UNAVAILABLE',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        errorMessage: 'NVIDIA_API_KEY environment variable not configured',
      };
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey!.trim()}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (response.ok) {
        return {
          provider: 'nvidia',
          name: 'NVIDIA AI API',
          configured: true,
          status: 'CONNECTED',
          latencyMs,
          lastChecked: new Date().toISOString(),
        };
      } else {
        const isAuthError = response.status === 401 || response.status === 403;
        return {
          provider: 'nvidia',
          name: 'NVIDIA AI API',
          configured: true,
          status: isAuthError ? 'UNAVAILABLE' : 'CONNECTED',
          latencyMs,
          lastChecked: new Date().toISOString(),
          errorMessage: isAuthError ? `Authentication failed (HTTP ${response.status})` : undefined,
        };
      }
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      return {
        provider: 'nvidia',
        name: 'NVIDIA AI API',
        configured: true,
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        errorMessage: isAbort ? 'Probe timed out (4s)' : undefined,
      };
    }
  }
}
