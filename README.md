# Trading Signal System

An institutional-grade automated trading signal generator, multi-asset market analytics engine, and execution funnel. Built with React 19, TypeScript, Express, and Firebase Firestore, featuring rigorous multi-timeframe confirmation, regime-adaptive scoring, empirical probability calibration, and native mobile packaging via Capacitor.

---

## Key Capabilities

### 1. Multi-Asset Universe
- **Broad Coverage**: Scans 113+ verified assets spanning Cryptocurrencies, Major/Minor Forex pairs, Commodities (Gold, Silver, Crude Oil), and Global Equity Indices.
- **Session-Aware Filtering**: Adapts execution constraints to exchange trading hours, preventing out-of-hours stock orders or illiquid session traps.

### 2. Comprehensive Multi-Gate Evaluation Pipeline
Every market candidate passes through an exhaustive sequence of quantitative quality and safety gates:

- **Gate 0 (Data Integrity & Geometry)**: Strict OHLC geometry validation, timestamp sequence validation, and anomaly filtering.
- **Gate 1 (Market Regime Identification)**: Dynamically classifies market structure (`STRONG_BULL_TREND`, `RANGE_BOUND`, `VOLATILE_EXPANSION`, `BREAKOUT`) using multi-length EMAs, ADX, Bollinger Band width, and ATR.
- **Gate 2 & 6 (Progressive MTF Confluence)**: Harmonizes Higher Timeframe (4H/1H), Medium Timeframe (15M), and Lower Timeframe (5M) momentum, trend, and structural alignment.
- **Gate 3 (Market Structure & BOS/CHOCH)**: Detects Break of Structure, Change of Character, and fractal swing high/low displacements.
- **Gate 4 (Momentum & Volatility)**: Gauges RSI, MACD histograms, and directional movement indices (DMI/ADX) with overextension rejection.
- **Gate 5 (Liquidity & Price Zones)**: Identifies institutional liquidity pools, order blocks, and support/resistance cluster confluence.
- **Gate 7 (Market Context & Safety)**: Evaluates macroeconomic event proximity and correlation-cluster risk exposure.
- **Gate 8 (Entry Quality & Tradeability)**: Verifies distance to key structural levels and executable bid/ask spreads.
- **Gate 9 (Risk Management & Canonical R:R)**: Enforces minimum gross R:R (1.8:1 minimum) and adverse net R:R thresholds.
- **Gate 19 & 20 (Regime Matrix & Probability Calibration)**: Adjusts probability models based on empirical historical outcome tracking and Wilson score confidence intervals.
- **Gate 21 & 22 (Walk-Forward & Monte Carlo Simulations)**: Validates strategy robustness across rolling out-of-sample data and runs 1,000+ permutation Monte Carlo stress tests for drawdown resilience.
- **Gate 26 (Opportunity Funnel)**: Tracks candidates across `WATCHING`, `QUALIFIED`, `ACCEPTED`, and `REJECTED` states.
- **Gate 30 (Data Freshness & Telemetry)**: Rejects stale tickers and outdated candle feeds before score calculation.
- **Gate 31 (News Risk Classification)**: Integrates real-time news and calendar feeds (Finnhub / Twelve Data) with fail-safe uncertainty penalties (CAUTION).
- **Gate 36 (Signal Cap Governance)**: Enforces configurable daily signal frequency limits and UTC-day exposure ceilings.

### 3. Execution & Data Reliability
- **Single Source of Truth**: All Stop-Loss (SL), Take-Profit targets (TP1/TP2/TP3), and Risk-to-Reward (R:R) values are computed canonically in `ScoringEngine` and verified by `RiskRewardCalculator`.
- **Absolute Target Positivity**: Multi-layer safeguards ensure no zero, negative, or inverted price targets can ever be emitted.
- **Non-Blocking Telemetry & Bounded Caches**: High-frequency cache operations run with asynchronous logging and memory caps to ensure stable event-loop latency.
- **Timing-Safe Admin Security**: Constant-time cryptographic verification on administrative endpoints protects secrets and configuration endpoints.
- **Configurable CORS Policies**: Dynamic origin whitelist configured via `ALLOWED_ORIGIN`.

---

## Architecture Overview

```
├── src/
│   ├── components/           # React UI (Signals, Funnel, Diagnostics, Charts, Settings)
│   ├── server/               # Express API and core scanner services
│   │   ├── market/           # Multi-provider clients, caching engine, request registry
│   │   ├── middleware/       # Admin authorization, rate limiting, and CORS handling
│   │   ├── routes/           # REST endpoints (/api/signals, /api/scanner, /api/market, etc.)
│   │   └── signals/          # Multi-gate pipeline, ScoringEngine, validation, and analytics
│   ├── types/                # Shared TypeScript models, signal interfaces, and enums
│   └── lib/                  # Firebase initialization, formatting, and UI helpers
├── tests/                    # Production regression test suite
├── server.ts                 # Full-stack server entry point (Express + Vite)
├── capacitor.config.ts       # Native Android / iOS configuration
├── firestore.rules           # Firestore security definitions
└── firebase-blueprint.json   # Schema definitions for persistent collections
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion, Recharts / D3
- **Backend**: Node.js, Express, tsx / esbuild
- **Persistence & Cloud**: Firebase Firestore, Firebase Auth, Local JSON fallbacks
- **Market Data Providers**: Bitget API, Twelve Data, Finnhub, ExchangeRate-API
- **Mobile Packaging**: Capacitor Android (`@capacitor/android`)
- **Build Tooling**: Vite 6, Tailwind CSS v4

---

## Getting Started

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables by copying `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Launch the development server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000`.

---

## Verification & Testing

- **Type Checking & Linting**:
  ```bash
  npm run lint
  ```

- **Regression & Safety Test Suite**:
  ```bash
  npx tsx tests/run-regression.ts
  ```

- **Production Build**:
  ```bash
  npm run build
  ```

- **Start Production Server**:
  ```bash
  npm run start
  ```

---

## Mobile Deployment (Capacitor Android)

To build and synchronize the web bundle with the native Android project:

```bash
npm run build
npx cap sync android
npx cap open android
```

---

## License

Private and Proprietary.
