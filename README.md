# Trading Signal System

An institutional-grade automated trading signal generator, multi-asset market analytics engine, and quantitative execution pipeline. Built with React 19, TypeScript, Express, and Firebase Firestore, featuring rigorous multi-timeframe confirmation, regime-adaptive scoring, canonical Risk/Reward qualification, empirical probability calibration, and native mobile packaging via Capacitor.

---

## Key Capabilities

### 1. Multi-Asset Universe & Session Routing
- **Broad Coverage**: Scans 113+ verified assets spanning Cryptocurrencies, Major/Minor Forex pairs, Commodities (Gold, Silver, Crude Oil), and Global Equity Indices.
- **Session-Aware Filtering**: Adapts execution constraints to exchange trading hours, preventing out-of-hours stock orders or illiquid session traps.
- **Dynamic Failover Providers**: Redundant live data ingestion from Bitget, Twelve Data, Finnhub, and ExchangeRate-API with automatic failover and caching.

---

### 2. Authoritative Take-Profit & Risk/Reward Architecture

All Stop-Loss (SL), Take-Profit targets (TP1/TP2/TP3), and Risk-to-Reward (R:R) ratios are computed canonically through `RiskRewardCalculator.ts` as the single authoritative source of truth.

#### Canonical R:R Formulation
For every candidate trade setup:
```typescript
const riskDistance = Math.abs(entryPrice - stopLoss);
const tp1RewardDistance = Math.abs(tp1 - entryPrice);
const tp2RewardDistance = Math.abs(tp2 - entryPrice);
const tp3RewardDistance = Math.abs(tp3 - entryPrice);

const tp1GrossRR = Number((tp1RewardDistance / riskDistance).toFixed(2));
const tp2GrossRR = Number((tp2RewardDistance / riskDistance).toFixed(2));
const tp3GrossRR = Number((tp3RewardDistance / riskDistance).toFixed(2));
```

#### Qualification Hierarchy
A candidate qualifies on Risk/Reward when:
$$\text{TP2 Gross R:R} \ge \text{minimumRR} \quad \text{OR} \quad \text{TP3 Gross R:R} \ge \text{minimumRR}$$
- **Primary Qualification (`TP2`)**: If `tp2GrossRR >= minimumRR`, the trade qualifies with `selectedTarget = 'TP2'`, `grossRR = tp2GrossRR`, and `passedViaTp3 = false`.
- **Extended Target Qualification (`TP3`)**: If `tp2GrossRR < minimumRR` but `tp3GrossRR >= minimumRR`, the trade qualifies with `selectedTarget = 'TP3'`, `grossRR = tp3GrossRR`, and `passedViaTp3 = true`.
- **Rejection**: If neither TP2 nor TP3 reaches `minimumRR`, the candidate is rejected with `selectedTarget = null` and `isValid = false`.
- **Configurable Threshold**: Minimum R:R is dynamically resolved from `serverConfig.thresholds.minimumRR` (1.80:1 default) with no hardcoded or hidden 1.50 bypass paths.

---

### 3. Quantitative Multi-Gate Evaluation Pipeline

Every market candidate passes through an exhaustive sequence of quantitative quality and safety gates:

- **Gate 0 (Data Integrity & Geometry)**: Strict OHLC geometry validation, timestamp sequence validation, and anomaly filtering.
- **Gate 1 (Market Regime Identification)**: Dynamically classifies market structure (`STRONG_BULL_TREND`, `STRONG_BEAR_TREND`, `RANGE_BOUND`, `VOLATILE_EXPANSION`, `BREAKOUT`) using multi-length EMAs, ADX, Bollinger Band width, and ATR.
- **Gate 2 & 6 (Progressive MTF Confluence)**: Harmonizes Higher Timeframe (4H/1H), Medium Timeframe (15M), and Lower Timeframe (5M) momentum, trend, and structural alignment.
- **Gate 3 (Market Structure & BOS/CHOCH)**: Detects Break of Structure, Change of Character, and fractal swing high/low displacements.
- **Gate 4 (Momentum & Volatility)**: Gauges RSI, MACD histograms, and directional movement indices (DMI/ADX) with overextension rejection.
- **Gate 5 (Liquidity & Price Zones)**: Identifies institutional liquidity pools, order blocks, and support/resistance cluster confluence.
- **Gate 7 (Market Context & Final Safety)**: Evaluates macroeconomic event proximity, correlation-cluster risk exposure, and final tradeability requirements.
- **Gate 8 (Entry Quality & Tradeability Threshold)**: Dynamically resolves tradeability thresholds against composite candidate scores.
- **Gate 9 & 45 (Risk Management & Canonical R:R)**: Enforces minimum gross R:R ($\ge 1.80:1$) and non-positive expectancy rejection.
- **Gate 19 & 20 (Regime Matrix & Probability Calibration)**: Adjusts probability models based on empirical historical outcome tracking and Wilson score confidence intervals.
- **Gate 21 & 22 (Walk-Forward & Monte Carlo Simulations)**: Validates strategy robustness across rolling out-of-sample data and runs 1,000+ permutation Monte Carlo stress tests for drawdown resilience.
- **Gate 34 (Execution Friction Stress Testing)**: Simulates real-world slippage, spread expansion, and exchange execution fees across normal and adverse market conditions.
- **Gate 35 (Opportunity Funnel & Telemetry)**: Tracks candidates across `CANDIDATE`, `GATE_1`, `GATE_6`, `STAGE_2`, and `FINAL_SIGNAL` lifecycle states without duplicate inflation.
- **Gate 36 (Signal Cap Governance)**: Enforces configurable daily signal frequency limits and UTC-day exposure ceilings.

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
│   │       ├── RiskRewardCalculator.ts         # Canonical R:R calculation and qualification
│   │       ├── ScoringEngine.ts                # Signal evaluation, scoring, and TP setup
│   │       ├── SignalValidator.ts              # Pre-execution and geometry validation
│   │       ├── Gate34ExecutionFrictionStressTest.ts # Friction and adverse Net R:R tests
│   │       ├── Gate7FinalTradeValidation.ts    # 13 Hard Gates final validation
│   │       ├── CandidateRejectionTracker.ts    # Telemetry and audit logging
│   │       └── StagedScannerPipeline.ts        # End-to-end scanning orchestrator
│   ├── types/                # Shared TypeScript models, signal interfaces, and enums
│   └── lib/                  # Firebase initialization, formatting, and UI helpers
├── tests/                    # Production regression test suite
│   └── run-regression.ts     # 59 automated test specifications
├── server.ts                 # Full-stack server entry point (Express + Vite)
├── capacitor.config.ts       # Native Android / iOS configuration
├── firestore.rules           # Firestore security definitions
└── firebase-blueprint.json   # Schema definitions for persistent collections
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion, Recharts
- **Backend**: Node.js, Express, tsx (dev), esbuild (production bundling)
- **Persistence & Cloud**: Firebase Firestore, Firebase Authentication, Local JSON fallbacks
- **Market Data Providers**: Bitget API, Twelve Data, Finnhub, ExchangeRate-API
- **Mobile Packaging**: Capacitor Android (`@capacitor/android`)
- **Build Tooling**: Vite 6, Tailwind CSS v4, TypeScript 5.8

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

2. Configure environment variables by creating `.env` (refer to `.env.example`):
   ```bash
   cp .env.example .env
   ```

3. Launch the development server:
   ```bash
   npm run dev
   ```
   The application dev server binds to `http://0.0.0.0:3000`.

---

## Verification & Testing

- **Regression Test Suite (59 Tests)**:
  ```bash
  npm test
  # or
  npx tsx tests/run-regression.ts
  ```

- **Type Checking & Linting**:
  ```bash
  npm run lint
  ```

- **Production Build**:
  ```bash
  npm run build
  ```

- **Production Server Launch**:
  ```bash
  npm run start
  ```

---

## Mobile Deployment (Capacitor Android)

To build the web application and synchronize with the native Android project:

```bash
npm run build
npx cap sync android
npx cap open android
```

---

## License

Private and Proprietary. All rights reserved.
