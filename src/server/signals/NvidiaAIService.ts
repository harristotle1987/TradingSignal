/**
 * NVIDIA AI Service Integration
 * Evaluates already-calculated technical & market data.
 * Does NOT generate market prices, candles, or entry levels.
 */

import { SignalDirection } from '../../types/index.js';
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
    htfEma9: number;
    htfEma21: number;
    htfRsi: number;
    ltfEma9: number;
    ltfEma21: number;
    ltfRsi: number;
    ltfMacdHistogram: number;
    atr: number;
  };
  rejectionReason?: string;
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
   * Evaluates the technical confluence result using NVIDIA AI API if configured.
   * Enforces Gate 33: AI Assessment is Qualitative, NOT Statistical Probability.
   */
  static async evaluate(analysis: ConfluenceAnalysisResult): Promise<NvidiaEvaluationResult> {
    const apiKey = serverConfig.getNvidiaApiKey();

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
      const timeoutId = setTimeout(() => controller.abort(), 6000);

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
}
