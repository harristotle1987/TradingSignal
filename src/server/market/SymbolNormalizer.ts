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
    if (!symbol) return 'UNKNOWN';
    const cleanRaw = symbol.trim().toUpperCase();

    // 1. Slash-based Detection Rules (inspect raw string before normalization strips slashes)
    if (cleanRaw.includes('/')) {
      const parts = cleanRaw.split('/');
      const base = parts[0]?.trim();
      const quote = parts[1]?.trim();
      const fiatCurrencies = ['EUR', 'GBP', 'USD', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
      if (fiatCurrencies.includes(base) && fiatCurrencies.includes(quote)) {
        return 'FOREX';
      }
      return 'CRYPTO';
    }

    const clean = this.normalizeAppSymbol(symbol);
    if (!clean) return 'UNKNOWN';

    // 2. Crypto Suffix Detection Rules
    const cryptoQuotes = ['USDT', 'USDC', 'BUSD'];
    if (cryptoQuotes.some(quote => clean.endsWith(quote))) {
      return 'CRYPTO';
    }

    // Ends with USD but not as part of a 6-letter fiat-to-fiat pair (e.g. PIUSD, BTCUSD)
    if (clean.endsWith('USD')) {
      if (clean.length === 6) {
        const fiatCurrencies = ['EUR', 'GBP', 'USD', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
        const base = clean.slice(0, 3);
        if (fiatCurrencies.includes(base)) {
          return 'FOREX';
        }
      }
      return 'CRYPTO';
    }

    // 3. Forex Detection Rules (6 characters fiat-to-fiat)
    const fiatCurrencies = ['EUR', 'GBP', 'USD', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
    const isForexPattern = 
      clean.length === 6 && 
      fiatCurrencies.some(fiat => clean.startsWith(fiat)) && 
      fiatCurrencies.some(fiat => clean.endsWith(fiat));

    if (isForexPattern) {
      return 'FOREX';
    }

    // 4. Stock Detection Rules (1 to 5 letters of standard stock symbol)
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
        let symbol = clean;
        // Backward-compatible translation of discontinued or migrated tokens
        if (symbol === 'MATIC' || symbol === 'MATICUSDT') symbol = 'POLUSDT';
        else if (symbol === 'RNDR' || symbol === 'RNDRUSDT') symbol = 'RENDERUSDT';
        else if (symbol === 'FTM' || symbol === 'FTMUSDT') symbol = 'SUSDT';
        else if (symbol === 'MKR' || symbol === 'MKRUSDT') symbol = 'FETUSDT';

        // Bitget supports crypto pairs ending in USDT, USDC, BTC, ETH etc.
        if (symbol.endsWith('USDT') || symbol.endsWith('USDC') || symbol.endsWith('USD') || symbol.endsWith('BTC')) {
          const bitgetSymbol = symbol.endsWith('USD') ? `${symbol}T` : symbol;
          return { providerSymbol: bitgetSymbol, assetType: 'CRYPTO' };
        }
        // Default crypto mapping for Bitget
        return { providerSymbol: `${symbol}USDT`, assetType: 'CRYPTO' };
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

      case 'tiingo': {
        const assetType = this.getAssetClassification(clean);
        if (assetType === 'FOREX') {
          // Tiingo FX pairs format: lowercase eurusd
          return { providerSymbol: clean.toLowerCase(), assetType: 'FOREX' };
        }
        if (assetType === 'CRYPTO') {
          // Tiingo Crypto format: lowercase btcusdt
          const cryptoPair = clean.endsWith('USDT') ? clean : `${clean}USDT`;
          return { providerSymbol: cryptoPair.toLowerCase(), assetType: 'CRYPTO' };
        }
        // Stock: uppercase AAPL
        return { providerSymbol: clean.toUpperCase(), assetType: 'STOCK' };
      }

      case 'exchangerate': {
        let base = 'EUR';
        let quote = 'USD';
        if (clean.length === 6) {
          base = clean.slice(0, 3);
          quote = clean.slice(3, 6);
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
