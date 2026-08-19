import { NormalizedCandle, SignalDirection, AssetType } from '../../types/index.js';

export interface Gate7Result {
  session: string;
  newsRisk: 'HIGH' | 'MEDIUM' | 'LOW';
  correlationContext: string;
  marketContextScore: number;
  tradingAllowed: 'YES' | 'NO' | 'CAUTION';
  reasons: string[];
}

export class Gate7MarketContext {
  public static analyze(
    symbol: string,
    proposedDirection: SignalDirection,
    candles: NormalizedCandle[]
  ): Gate7Result {
    const reasons: string[] = [];
    
    // Infer asset class based on symbol conventions (fallback to basic heuristics)
    const assetClass = this.inferAssetClass(symbol);
    
    // Evaluate session based on current UTC time
    const currentUtcHour = new Date().getUTCHours();
    const currentUtcMin = new Date().getUTCMinutes();
    const decimalHour = currentUtcHour + currentUtcMin / 60;
    
    let session = 'UNKNOWN';
    let marketContextScore = 50;
    let tradingAllowed: 'YES' | 'NO' | 'CAUTION' = 'YES';
    
    if (assetClass === 'FOREX') {
       session = this.getForexSession(decimalHour);
       
       if (session === 'Asian (Tokyo)') {
          marketContextScore -= 10;
          reasons.push('Asian session tends to have lower volatility and tighter ranges.');
       } else if (session === 'London') {
          marketContextScore += 15;
          reasons.push('London session offers high liquidity and trend initiation.');
       } else if (session === 'London/NY Overlap') {
          marketContextScore += 25;
          reasons.push('London/NY Overlap offers peak liquidity and optimal momentum.');
       } else if (session === 'New York') {
          marketContextScore += 10;
       } else if (session === 'Sydney') {
          marketContextScore -= 20;
          reasons.push('Sydney session features low liquidity; breakout strategies carry higher risk.');
       }
    } else if (assetClass === 'STOCK' || assetClass === 'INDEX') {
       session = this.getUSStockSession(decimalHour);
       
       if (session === 'Pre-Market' || session === 'After Hours') {
          marketContextScore -= 40;
          tradingAllowed = 'CAUTION';
          reasons.push('Out-of-hours stock trading has poor liquidity, erratic spreads, and high slippage risk.');
       } else if (session === 'Market Open') {
          marketContextScore -= 10; // High volatility/whipsaws
          reasons.push('Market Open (first 30-60m) is prone to volatile whipsaws and traps.');
       } else if (session === 'Regular Session') {
          marketContextScore += 20;
       } else if (session === 'Power Hour') {
          marketContextScore += 10;
       }
    } else if (assetClass === 'CRYPTO') {
       session = '24/7 Market';
       marketContextScore += 10; // Neutral baseline for Crypto, assuming 24/7 is standard
       reasons.push('Crypto operates 24/7. Monitoring for volume bursts linked to US equity open.');
       
       if (decimalHour >= 13.5 && decimalHour <= 15.5) {
          marketContextScore += 10;
          reasons.push('US Equity open overlap often provides institutional crypto volatility.');
       }
    }
    
    // Stub News Risk (Since we lack a live Economic Calendar feed in this sandbox)
    // We will assume neutral, but build the architecture to block trading.
    const newsRisk = 'LOW' as 'HIGH' | 'MEDIUM' | 'LOW';
    if (newsRisk === 'HIGH') {
       tradingAllowed = 'NO';
       marketContextScore -= 50;
       reasons.push('High impact news event approaching. Automated trading blocked to prevent slippage/whipsaws.');
    }

    // Stub Correlation Context (e.g. BTC for Crypto, SPY for Stocks, DXY for Forex)
    let correlationContext = 'NEUTRAL';
    // In a live environment, we'd query the SPY/BTC/DXY trend here and compare it to proposedDirection.
    // For now, we simulate a neutral alignment check.
    if (assetClass === 'CRYPTO') {
       correlationContext = 'Pending BTC Dominance / Trend check';
    } else if (assetClass === 'STOCK') {
       correlationContext = 'Pending SPY/QQQ sector alignment check';
    } else if (assetClass === 'FOREX') {
       correlationContext = 'Pending DXY strength check';
    }
    
    marketContextScore = Math.max(0, Math.min(100, marketContextScore));

    if (tradingAllowed === 'YES' && marketContextScore < 30) {
       tradingAllowed = 'CAUTION';
    }

    return {
       session,
       newsRisk,
       correlationContext,
       marketContextScore,
       tradingAllowed,
       reasons
    };
  }

  private static inferAssetClass(symbol: string): AssetType {
    const s = symbol.toUpperCase();
    if (s.endsWith('USDT') || s.endsWith('BUSD') || s.endsWith('USDC') || s.endsWith('BTC') || s.endsWith('ETH')) return 'CRYPTO';
    if (s.length === 6 && !s.includes('-')) return 'FOREX'; // e.g. EURUSD
    if (s.includes('EUR') || s.includes('GBP') || s.includes('JPY') || s.includes('AUD')) return 'FOREX';
    return 'STOCK'; // Default to stock
  }

  private static getForexSession(decimalHourUtc: number): string {
    if (decimalHourUtc >= 13 && decimalHourUtc < 17) return 'London/NY Overlap';
    if (decimalHourUtc >= 8 && decimalHourUtc < 13) return 'London';
    if (decimalHourUtc >= 17 && decimalHourUtc < 22) return 'New York';
    if (decimalHourUtc >= 0 && decimalHourUtc < 8) return 'Asian (Tokyo)';
    return 'Sydney';
  }

  private static getUSStockSession(decimalHourUtc: number): string {
    // 9:30 AM EST = 13:30 UTC or 14:30 UTC depending on DST. Assume 13:30 UTC for Standard/DST simplification in this stub.
    if (decimalHourUtc < 13.5) return 'Pre-Market';
    if (decimalHourUtc >= 13.5 && decimalHourUtc < 14.5) return 'Market Open';
    if (decimalHourUtc >= 14.5 && decimalHourUtc < 19) return 'Regular Session';
    if (decimalHourUtc >= 19 && decimalHourUtc < 20) return 'Power Hour';
    return 'After Hours';
  }
}
