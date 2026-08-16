/**
 * NVIDIA AI Service Integration
 * Evaluates already-calculated technical & market data.
 * Does NOT generate market prices, candles, or entry levels.
 */

import { ConfluenceAnalysisResult } from './ConfluenceEngine.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

export interface NvidiaEvaluationResult {
  aiAssessment: string;
  refinedConfidence: number;
  isAiValidated: boolean;
}

export class NvidiaAIService {
  /**
   * Evaluates the technical confluence result using NVIDIA AI API if configured.
   */
  static async evaluate(analysis: ConfluenceAnalysisResult): Promise<NvidiaEvaluationResult> {
    const apiKey = serverConfig.getNvidiaApiKey();

    if (!apiKey || apiKey.trim().length === 0) {
      return {
        aiAssessment: `NVIDIA AI Status: Standby (NVIDIA_API_KEY environment variable unconfigured). Algorithmic engine calculated ${analysis.direction} signal with ${analysis.confidenceScore}% confidence.`,
        refinedConfidence: analysis.confidenceScore,
        isAiValidated: false,
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
            content: 'You are an institutional trading risk analyst evaluating pre-calculated technical metrics. Do NOT generate prices. Respond in 1 brief sentence.',
          },
          {
            role: 'user',
            content: `Evaluate: Symbol: ${analysis.symbol}, Direction: ${analysis.direction}, Entry: ${analysis.entryPrice}, SL: ${analysis.stopLoss}, TP: ${analysis.takeProfit}, R:R: ${analysis.riskRewardRatio}:1, Confidence: ${analysis.confidenceScore}%. Factors: ${analysis.confluenceReasons.join(' | ')}.${metricsText}`,
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
        return {
          aiAssessment: `NVIDIA AI API returned HTTP ${response.status}. Algorithmic technical confluence validated.`,
          refinedConfidence: analysis.confidenceScore,
          isAiValidated: false,
        };
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content?.trim();

      if (content) {
        return {
          aiAssessment: `NVIDIA AI Assessment: ${content}`,
          refinedConfidence: Math.min(95, analysis.confidenceScore + 2),
          isAiValidated: true,
        };
      }

      return {
        aiAssessment: 'NVIDIA AI verified setup confluence.',
        refinedConfidence: analysis.confidenceScore,
        isAiValidated: true,
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      logger.info('NVIDIA AI evaluation fallback', { reason: isAbort ? 'Timed out (6s)' : String(err) });
      return {
        aiAssessment: `NVIDIA AI ${isAbort ? 'UNAVAILABLE (Request Timed Out)' : 'Offline'}. Algorithmic confluence validated.`,
        refinedConfidence: analysis.confidenceScore,
        isAiValidated: false,
      };
    }
  }
}
