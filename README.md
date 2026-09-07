# Trading Signal System

An institutional-grade automated trading signal generator, multi-asset market analytics engine, and execution funnel. Built with React 19, TypeScript, Express, and Firebase Firestore, featuring rigorous multi-timeframe confirmation, regime-adaptive scoring, empirical probability calibration, and native mobile packaging via Capacitor.

---

## Key Capabilities

### 1. Multi-Asset Universe & Session Intelligence
- **Broad Coverage**: Scans 113+ verified assets spanning Cryptocurrencies (Bitget API), Major/Minor Forex pairs (Twelve Data), Commodities (Gold, Silver, Crude Oil), and Global Equity Indices (Finnhub).
- **Session-Aware Screening**: Adapts execution constraints to exchange trading hours, preventing out-of-hours stock orders or illiquid session traps.

### 2. Comprehensive Multi-Gate Evaluation Pipeline
Every market candidate passes through an exhaustive sequence of quantitative quality and safety gates:

- **Gate 0 (Data Integrity & Geometry)**: Strict OHLC geometry validation, timestamp sequence validation, gap detection, and anomaly filtering.
- **Gate 1 (Market Regime Identification)**: Dynamically classifies market structure (`STRONG_BULL_TREND`, `STRONG_BEAR_TREND`, `RANGE_BOUND`, `VOLATILE_EXPANSION`, `BREAKOUT`) using multi-length EMAs, ADX, Bollinger Band width, and ATR.
- **Gate 2 (Two-Level Scanner Deadlines & Operational Ceilings)**: Enforces a 16,000ms soft deadline to stop initiating new candidate deep evaluations and a 17,500ms hard deadline to abort provider queries, strictly respecting an 18,000ms global operational ceiling.
- **Gate 3 & Gate 9 (Canonical Take-Profit & Multi-Target R:R Qualification)**:
  - **Multi-Target Hierarchy**: Evaluates TP2 first against `minimumRR` ($\ge 1.80$). If TP2 falls short but TP3 satisfies the threshold, the trade qualifies via TP3. If neither qualifies, the candidate is rejected with `grossRR = 0`.
  - **Single Source of Truth**: All R:R ratios are canonically computed via `RiskRewardCalculator.calculate()` without client/server discrepancies.
  - **10-Point Diagnostic Telemetry**: Logs granular diagnostics on every R:R rejection, reporting entry, SL, risk distance, structural anchors, and maximum TP guardrails.
  - **Gate Independence**: Score thresholds and R:R minimums are independently enforced; high algorithmic scores can never override failing R:R geometry.
- **Gate 4 (Momentum & Volatility)**: Evaluates RSI, MACD histograms, and directional movement indices (DMI/ADX) with overextension rejection.
- **Gate 5 (Liquidity & Price Zones)**: Identifies institutional liquidity pools, order blocks, and support/resistance cluster confluence.
- **Gate 6 (Progressive MTF Confluence)**: Harmonizes Higher Timeframe (4H/1H), Medium Timeframe (15M), and Lower Timeframe (5M) momentum, trend, and structural alignment.
- **Gate 7 (Rejection Deduplication & Counter Consistency)**: Deduplicates candidate rejection logs and ensures strict funnel counter consistency (`candidateRejectionDetails.length === rejectedCount === candidatesRejectedFinal`).
- **Gate 8 (Entry Quality & Tradeability)**: Verifies distance to key structural levels and executable bid/ask spreads.
- **Gate 19 & 20 (Regime Matrix & Probability Calibration)**: Adjusts probability models based on empirical historical outcome tracking and Wilson score confidence intervals.
- **Gate 21 & 22 (Walk-Forward & Monte Carlo Stress Testing)**: Validates strategy robustness across rolling out-of-sample data and runs 1,000+ permutation Monte Carlo simulations for drawdown resilience.
- **Gate 26 (Opportunity Funnel)**: Tracks candidates across `Screened` $\to$ `Preliminary` $\to$ `Deep Analysis` $\to$ `MTF Confluence` $\to$ `Threshold+` $\to$ `Signals Generated` $\to$ `Accepted`.
- **Gate 30 (Data Freshness & Telemetry)**: Rejects stale tickers and outdated candle feeds before score calculation.
- **Gate 31 (News Risk Classification)**: Integrates real-time news and calendar feeds (Finnhub / Twelve Data) with fail-safe uncertainty penalties.
- **Gate 36 (Signal Cap Governance)**: Enforces configurable daily signal frequency limits and UTC-day exposure ceilings.

### 3. Execution & Data Reliability
- **Absolute Target Positivity**: Multi-layer safeguards ensure no zero, negative, or inverted price targets can ever be emitted.
- **Non-Blocking Telemetry & Bounded Caches**: High-frequency cache operations run with asynchronous logging and memory caps to ensure stable event-loop latency.
- **Timing-Safe Admin Security**: Constant-time cryptographic verification on administrative endpoints protects secrets and configuration endpoints.
- **Configurable CORS Policies**: Dynamic origin whitelist configured via `ALLOWED_ORIGINS`.

---

## Architecture Overview

```
├── src/
│   ├── components/           # React 19 UI (Signals, Funnel, Diagnostics, Charts, Settings)
│   ├── server/               # Express API and core scanner services
│   │   ├── market/           # Multi-provider clients (Bitget, Twelve Data, Finnhub), cache engine
│   │   ├── middleware/       # Admin authorization, rate limiting, and CORS handling
│   │   ├── routes/           # REST endpoints (/api/signals, /api/scanner, /api/market, etc.)
│   │   └── signals/          # Core pipeline engines:
│   │       ├── RiskRewardCalculator.ts     # Canonical multi-target R:R calculation & 10-point diagnostics
│   │       ├── ScoringEngine.ts            # Quantitative scoring & Take-Profit generation
│   │       ├── StagedScannerPipeline.ts    # Staged scanner with two-level deadline enforcement
│   │       ├── CandidateRejectionTracker.ts# Deduplicated candidate audit logs & counter consistency
│   │       ├── SignalValidator.ts          # Pre-emission tradeability and guardrail verification
│   │       └── Gate7FinalTradeValidation.ts# Final hard and soft gate execution checks
│   ├── types/                # Shared TypeScript models, signal interfaces, and enums
│   └── lib/                  # Firebase initialization, formatting, and UI helpers
├── tests/                    # Production regression test suite (67 comprehensive tests)
├── server.ts                 # Full-stack server entry point (Express + Vite)
├── capacitor.config.ts       # Native Android / iOS configuration
├── firestore.rules           # Firestore security definitions
└── firebase-blueprint.json   # Schema definitions for persistent collections
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Motion, Recharts / D3
- **Backend**: Node.js, Express, tsx / esbuild
- **Persistence & Cloud**: Firebase Firestore, Firebase Auth, Local JSON fallbacks
- **Market Data Providers**: Bitget API, Twelve Data, Finnhub, ExchangeRate-API
- **Mobile Packaging**: Capacitor Android (`@capacitor/android`)
- **Build Tooling**: Vite 6, Tailwind CSS v4

---

## Environment Configuration

Copy `.env.example` to `.env` and configure your API credentials and thresholds:

```bash
cp .env.example .env
```

### Key Environment Variables

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `PORT` | Server | HTTP port (default: `3000`) |
| `NODE_ENV` | Server | Environment mode (`development` or `production`) |
| `ADMIN_SECRET` / `ADMIN_KEY` | Server | Key for administrative endpoints and config mutations |
| `SCANNER_CRON_SECRET` | Server | Authorization secret for external scanner triggers (`/api/scanner/trigger`) |
| `CRONJOB_ORG_API_KEY` | Server | Optional cron-job.org integration for automated scheduler telemetry |
| `TWELVE_DATA_API_KEY` | Server | API key for Forex market data feeds |
| `FINNHUB_API_KEY` | Server | API key for Stock/Index market data and economic calendar feeds |
| `BITGET_API_KEY` | Server | API key for Crypto market data feeds |
| `FIREBASE_SERVICE_ACCOUNT` | Server | Service account JSON credentials for Firestore |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Server | Web Push notification credentials |
| `THRESHOLD_MIN_RR` | Server | Minimum acceptable Gross Risk-to-Reward ratio (default: `1.8`) |
| `THRESHOLD_MIN_SCORE` | Server | Minimum quantitative score to accept a signal (default: `70`) |

---

## Getting Started

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation & Local Development

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

The project maintains a comprehensive, zero-mock regression test suite verifying all scanning stages, deadline enforcement, rejection deduplication, and canonical R:R calculations:

```bash
# Run the full regression test suite (67 tests)
npm test

# Run TypeScript type checking
npm run lint

# Compile production bundle
npm run build

# Launch compiled production bundle
npm run start
```

---

## Deployment

### 1. Standalone / Cloud Run (Docker / Node.js)

The project includes an optimized single-step production build bundling the Express backend into `dist/server.cjs` and the client into static assets:

```bash
npm run build
npm start
```

### 2. Vercel Deployment Notes

If deploying to **Vercel**:
- **Hobby Plan Single-Author Restriction**: Vercel's free Hobby plan blocks private repository deployments if the Git commit author email does not match your Vercel account email.
  - Verify your local Git config: `git config user.email`
  - Align it with your Vercel email: `git config --global user.email "your-email@example.com"`
  - Amend existing commits if necessary: `git commit --amend --reset-author --no-edit && git push --force`

### 3. Mobile Deployment (Capacitor Android)

To build and synchronize the web bundle with the native Android project:

```bash
npm run build
npx cap sync android
npx cap open android
```

---

## License

Private and Proprietary.
