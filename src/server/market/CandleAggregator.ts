/**
 * Utility for aggregating lower-timeframe OHLC candles into target timeframes.
 * STRICT INTEGRITY:
 * - Does NOT create synthetic or fake candles.
 * - Requires genuine lower-timeframe candles.
 * - Computes exact Open, High, Low, Close, Volume, and Timestamp buckets.
 */

import { NormalizedCandle } from './types.js';

export function parseTimeframeMs(tf: string): number | null {
  const norm = tf.toLowerCase().trim();
  if (norm.endsWith('min') || norm.endsWith('m')) {
    const mins = parseInt(norm, 10);
    return !isNaN(mins) && mins > 0 ? mins * 60 * 1000 : null;
  }
  if (norm.endsWith('hour') || norm.endsWith('h')) {
    const hrs = parseInt(norm, 10);
    return !isNaN(hrs) && hrs > 0 ? hrs * 60 * 60 * 1000 : null;
  }
  if (norm.endsWith('day') || norm.endsWith('d')) {
    const days = parseInt(norm, 10);
    return !isNaN(days) && days > 0 ? days * 24 * 60 * 60 * 1000 : null;
  }
  if (norm.endsWith('week') || norm.endsWith('w')) {
    const weeks = parseInt(norm, 10);
    return !isNaN(weeks) && weeks > 0 ? weeks * 7 * 24 * 60 * 60 * 1000 : null;
  }
  return null;
}

export function aggregateOHLCCandles(
  lowerCandles: NormalizedCandle[],
  targetTimeframe: string,
  targetLimit: number
): NormalizedCandle[] {
  const targetMs = parseTimeframeMs(targetTimeframe);
  if (!targetMs || lowerCandles.length === 0) return [];

  const buckets = new Map<number, NormalizedCandle[]>();
  for (const candle of lowerCandles) {
    if (!candle || candle.timestamp <= 0) continue;
    const bucketTime = Math.floor(candle.timestamp / targetMs) * targetMs;
    const list = buckets.get(bucketTime) || [];
    list.push(candle);
    buckets.set(bucketTime, list);
  }

  const aggregated: NormalizedCandle[] = [];
  const sortedBucketKeys = Array.from(buckets.keys()).sort((a, b) => b - a);

  for (const bTime of sortedBucketKeys) {
    const list = buckets.get(bTime)!;
    if (list.length === 0) continue;

    list.sort((a, b) => a.timestamp - b.timestamp);

    const open = list[0].open;
    const close = list[list.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volumeSum: number | null = null;
    let hasVolume = false;

    for (const c of list) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      if (c.volume !== null && !isNaN(c.volume)) {
        volumeSum = (volumeSum ?? 0) + c.volume;
        hasVolume = true;
      }
    }

    if (
      !isNaN(open) && open > 0 &&
      !isNaN(high) && high > 0 &&
      !isNaN(low) && low > 0 &&
      !isNaN(close) && close > 0 &&
      high >= low && high >= open && high >= close &&
      low <= open && low <= close
    ) {
      aggregated.push({
        symbol: list[0].symbol,
        provider: list[0].provider,
        timeframe: targetTimeframe,
        open,
        high,
        low,
        close,
        volume: hasVolume ? volumeSum : null,
        timestamp: bTime,
      });
    }

    if (aggregated.length >= targetLimit) break;
  }

  return aggregated;
}
