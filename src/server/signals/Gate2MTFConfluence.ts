import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export type TFDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'PULLBACK_BULL' | 'PULLBACK_BEAR' | 'UNKNOWN';

export interface Gate2MTFResult {
  htfDirection: TFDirection;
  mtfDirection: TFDirection;
  ltfDirection: TFDirection;
  alignmentScore: number; // 0-100
  conflicts: string[];
  confluenceStatus: 'STRONG_CONFLUENCE' | 'WEAK_CONFLUENCE' | 'CONTRADICTION' | 'UNKNOWN';
}

export class Gate2MTFConfluence {
  public static evaluateConfluence(
    proposedDirection: SignalDirection,
    timeframes: Record<string, NormalizedCandle[]>
  ): Gate2MTFResult {
    // 1. Identify HTF, MTF, LTF
    const htf = timeframes['4h'] && timeframes['4h'].length >= 50 ? '4h' : (timeframes['1h'] && timeframes['1h'].length >= 50 ? '1h' : null);
    const mtf = timeframes['15m'] && timeframes['15m'].length >= 50 ? '15m' : (timeframes['1h'] && htf !== '1h' ? '1h' : null);
    const ltf = timeframes['5m'] && timeframes['5m'].length >= 50 ? '5m' : null;

    let htfDir: TFDirection = 'UNKNOWN';
    let mtfDir: TFDirection = 'UNKNOWN';
    let ltfDir: TFDirection = 'UNKNOWN';

    if (htf) htfDir = this.analyzeDirection(timeframes[htf]);
    if (mtf) mtfDir = this.analyzeDirection(timeframes[mtf]);
    if (ltf) ltfDir = this.analyzeDirection(timeframes[ltf]);

    const conflicts: string[] = [];
    let score = 100;

    // Check HTF
    if (proposedDirection === 'BUY') {
      if (htfDir === 'BEARISH' || htfDir === 'PULLBACK_BEAR') {
        conflicts.push(`HTF (${htf}) is ${htfDir}, contradicting BUY proposal`);
        score -= 50;
      } else if (htfDir === 'NEUTRAL') {
         score -= 10;
      }
      
      if (mtfDir === 'BEARISH') {
        conflicts.push(`MTF (${mtf}) is BEARISH, fighting the BUY setup`);
        score -= 30;
      } else if (mtfDir === 'PULLBACK_BEAR') {
        conflicts.push(`MTF (${mtf}) is PULLBACK_BEAR, weak context for BUY`);
        score -= 20;
      }
      
      if (ltfDir === 'BEARISH') {
        conflicts.push(`LTF (${ltf}) is BEARISH, delaying entry`);
        score -= 20;
      }
    } else if (proposedDirection === 'SELL') {
      if (htfDir === 'BULLISH' || htfDir === 'PULLBACK_BULL') {
        conflicts.push(`HTF (${htf}) is ${htfDir}, contradicting SELL proposal`);
        score -= 50;
      } else if (htfDir === 'NEUTRAL') {
         score -= 10;
      }
      
      if (mtfDir === 'BULLISH') {
        conflicts.push(`MTF (${mtf}) is BULLISH, fighting the SELL setup`);
        score -= 30;
      } else if (mtfDir === 'PULLBACK_BULL') {
        conflicts.push(`MTF (${mtf}) is PULLBACK_BULL, weak context for SELL`);
        score -= 20;
      }
      
      if (ltfDir === 'BULLISH') {
        conflicts.push(`LTF (${ltf}) is BULLISH, delaying entry`);
        score -= 20;
      }
    }

    if (score < 0) score = 0;

    let status: Gate2MTFResult['confluenceStatus'] = 'STRONG_CONFLUENCE';
    if (score < 50) status = 'CONTRADICTION';
    else if (score < 80) status = 'WEAK_CONFLUENCE';
    
    // Safety fallback
    if (!htf && !mtf) {
      status = 'UNKNOWN';
      score = 0;
    }

    return {
      htfDirection: htfDir,
      mtfDirection: mtfDir,
      ltfDirection: ltfDir,
      alignmentScore: score,
      conflicts,
      confluenceStatus: status
    };
  }

  private static analyzeDirection(candles: NormalizedCandle[]): TFDirection {
    if (!candles || candles.length < 50) return 'UNKNOWN';
    
    const closes = candles.map(c => c.close);
    const ema20 = TechnicalIndicators.calculateEMA(candles, 20);
    const ema50 = TechnicalIndicators.calculateEMA(candles, 50);
    const ema200 = TechnicalIndicators.calculateEMA(candles, 200);

    const e20 = ema20[ema20.length - 1];
    const e50 = ema50[ema50.length - 1];
    const e200 = ema200[ema200.length - 1] || e50;

    const struct = TechnicalIndicators.calculateMarketStructure(candles, 15);
    const price = closes[closes.length - 1];

    const isBull = e20 > e50 && e50 > e200;
    const isBear = e20 < e50 && e50 < e200;

    if (isBull && struct.structureBias === 'BULLISH') return 'BULLISH';
    if (isBear && struct.structureBias === 'BEARISH') return 'BEARISH';

    // Pullback Detection
    if (e50 > e200 && (e20 < e50 || struct.structureBias === 'BEARISH' || price < e20)) return 'PULLBACK_BULL';
    if (e50 < e200 && (e20 > e50 || struct.structureBias === 'BULLISH' || price > e20)) return 'PULLBACK_BEAR';

    // General Price Alignment
    if (price > e50 && price > e200) return 'BULLISH';
    if (price < e50 && price < e200) return 'BEARISH';

    return 'NEUTRAL';
  }
}
