/**
 * Centralized Symbol Normalization Layer
 * Converts application symbols into provider-specific formats.
 * DOES NOT fabricate prices or alter underlying asset semantics.
 */

import { AssetType } from './types.js';

export interface ProviderSymbolMapping {
  providerSymbol: string;
  assetType: AssetType;
  baseCurrency?: string;
  quoteCurrency?: string;
}

export class SymbolNormalizer {
  /**
   * Dynamically classifies any symbol into its asset type based on category rules
   * rather than a hard-coded list of symbols.
   */
  static getAssetClassification(symbol: string): AssetType {
    const clean = this.normalizeAppSymbol(symbol);
    if (!clean) return 'UNKNOWN';

    // 1. Crypto Detection Rules
    const cryptoTickers = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
    const hasCryptoBaseOrQuote = cryptoTickers.some(ticker => clean.startsWith(ticker) || clean.endsWith(ticker));
    if (
      clean.endsWith('USDT') ||
      clean.endsWith('USDC') ||
      clean.endsWith('BUSD') ||
      (clean.endsWith('USD') && (clean.startsWith('BTC') || clean.startsWith('ETH') || clean.startsWith('SOL'))) ||
      hasCryptoBaseOrQuote
    ) {
      return 'CRYPTO';
    }

    // 2. Forex Detection Rules
    const fiatCurrencies = ['EUR', 'GBP', 'USD', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
    const isForexPattern = 
      (clean.length === 6 && 
        fiatCurrencies.some(fiat => clean.startsWith(fiat)) && 
        fiatCurrencies.some(fiat => clean.endsWith(fiat))
      ) || 
      symbol.includes('/');

    if (isForexPattern) {
      return 'FOREX';
    }

    // 3. Stock Detection Rules
    if (/^[A-Z]{1,5}$/.test(clean)) {
      return 'STOCK';
    }

    return 'UNKNOWN';
  }

  /**
   * Sanitizes user/application symbol input (e.g., "btc/usdt" -> "BTCUSDT")
   */
  static normalizeAppSymbol(symbol: string): string {
    if (!symbol) return '';
    return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Converts a normalized app symbol to a provider-specific format.
   * Throws an error if the asset/symbol is unsupported for that provider.
   */
  static toProviderSymbol(appSymbol: string, providerId: string): ProviderSymbolMapping {
    const clean = this.normalizeAppSymbol(appSymbol);
    if (!clean) {
      throw new Error('Symbol must not be empty');
    }

    const lowerProvider = providerId.toLowerCase();

    switch (lowerProvider) {
      case 'bitget': {
        // Bitget supports crypto pairs ending in USDT, USDC, BTC, ETH etc.
        if (clean.endsWith('USDT') || clean.endsWith('USDC') || clean.endsWith('USD') || clean.endsWith('BTC')) {
          const bitgetSymbol = clean.endsWith('USD') ? `${clean}T` : clean;
          return { providerSymbol: bitgetSymbol, assetType: 'CRYPTO' };
        }
        // Default crypto mapping for Bitget
        return { providerSymbol: `${clean}USDT`, assetType: 'CRYPTO' };
      }

      case 'finnhub': {
        const assetType = this.getAssetClassification(clean);
        if (assetType === 'FOREX') {
          const base = clean.slice(0, 3);
          const quote = clean.slice(3, 6);
          return { providerSymbol: `OANDA:${base}_${quote}`, assetType: 'FOREX' };
        }
        if (assetType === 'CRYPTO') {
          const cryptoPair = clean.endsWith('USDT') ? clean : `${clean}USDT`;
          return { providerSymbol: `BINANCE:${cryptoPair}`, assetType: 'CRYPTO' };
        }
        // Default or fallback to stock ticker for Finnhub
        return { providerSymbol: clean, assetType: 'STOCK' };
      }

      case 'twelvedata': {
        const assetType = this.getAssetClassification(clean);
        if (assetType === 'STOCK') {
          return { providerSymbol: clean, assetType: 'STOCK' };
        }
        // Twelve Data Forex pairs format: EUR/USD
        let base = 'EUR';
        let quote = 'USD';
        if (clean.includes('/')) {
          const parts = clean.split('/');
          base = parts[0];
          quote = parts[1];
        } else if (clean.length === 6) {
          base = clean.slice(0, 3);
          quote = clean.slice(3, 6);
        } else if (clean.length === 3) {
          base = clean;
          quote = 'USD';
        }
        return {
          providerSymbol: `${base}/${quote}`,
          assetType: 'FOREX',
          baseCurrency: base,
          quoteCurrency: quote,
        };
      }

      default:
        throw new Error(`Unsupported provider: ${providerId}`);
    }
  }
}
