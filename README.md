# Trading Signal Platform

An automated cryptocurrency and multi-asset trading signal generator and high-speed market analytics engine. Built with React, TypeScript, Express, and Firebase, featuring progressive multi-timeframe analysis, strict risk-managed signal scoring, bounded parallel execution, and cross-platform mobile support via Capacitor.

---

## Key Features

- **Automated Market Scanner**: Periodically sweeps cryptocurrency and forex market universes across configurable schedules with an internal safety deadline manager.
- **Progressive Staged Scanner Pipeline**: Setups undergo rigorous phased evaluation with early candidate termination at each stage:
  - **Gate 0 (Data Integrity)**: Strict OHLC geometry validation, volume checks, and price synchronization tracking.
  - **Gate 1 (Regime Detection)**: Identifies precise market states (e.g., `STRONG_BULL_TREND`, `BREAKOUT`) using technical indicator combinations (EMAs, ADX, Bollinger Band width, ATR).
  - **Gate 2 (Distributed Lock & Confluence)**: Uses Firestore document locking (`scanner/lock`) for atomic execution and evaluates structural context.
  - **Gate 3 (Progressive Cheap Screening)**: Screens 100+ assets down to top 30–45 candidates using 1H data. Candidates failing trend alignment, liquidity, or basic structure halt processing immediately.
  - **Gate 4 (Dynamic Request Budgeting)**: Dynamically caps deep analysis candidates (8–12) based on real-time API health and rate limit quotas.
  - **Gate 5 (Pre-Ranking & Adaptive Selection)**: Filters and ranks the strongest candidates down to top 3–5 for multi-timeframe evaluation.
  - **Gate 6 (Progressive Multi-Timeframe Confluence)**:
    - **Layer 1 (15m + 1h)**: Evaluates fast MTF agreement concurrently; halts non-confluent candidates before fetching 5m/4h data.
    - **Layer 2 (5m + 4h)**: Validates fine structure, ATR, and support/resistance boundaries exclusively on Layer 1 survivors.
  - **Gate 7 (Executable Entry & Final Validation)**: Validates institutional volume expansion, news risk, spread friction, and risk-reward ratio to produce 0–3 high-probability tradeable signals.
- **Cron Optimization & Time Budget Safety**:
  - **Hard Internal Deadline (24s)**: Guarantees completion below external serverless 30s timeouts. Safely halts new requests while preserving valid candidate results (`TIME_BUDGET_EXCEEDED` status).
  - **Fast Cron Endpoint**: Skips UI rendering, heavy historical queries, and AI chatbot calls during cron runs.
  - **Granular Timing Telemetry**: Tracks execution benchmarks across `TOTAL SCAN TIME`, `DATA FETCH TIME`, `SCREENING TIME`, `RANKING TIME`, `MTF TIME`, `VALIDATION TIME`, and `DATABASE TIME`.
- **Safety & Cap Governance**: Enforces a daily automated signal ceiling per UTC day to prevent over-trading and market exposure overflow.
- **Market Diagnostics**: Live ticker monitoring, order book depth analytics, and multi-asset class scanners.
- **Cross-Platform Readiness**: Responsive web UI optimized for mobile viewports, bundled with Capacitor for native Android deployment.

---

## Architecture Overview

```
├── src/
│   ├── components/       # UI components (Signals, Scanner, Diagnostics, Settings)
│   ├── server/           # Express server logic
│   │   ├── market/       # MarketDataManager, provider adapters, caching layer
│   │   ├── routes/       # API endpoints (/api/signals, /api/scanner, etc.)
│   │   └── signals/      # StagedScannerPipeline, Gate3-Gate7 stages, HourlyScanner, persistence
│   ├── types/            # TypeScript interfaces, timing telemetry, and signal definitions
│   └── lib/              # Firebase & utility functions
├── server.ts             # Express entry point with Vite middleware / static server
├── capacitor.config.ts   # Mobile configuration for Capacitor Android
└── firebase-blueprint.json # Firestore schema & blueprint definition
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion
- **Backend**: Node.js, Express, tsx / esbuild
- **Database & Auth**: Firebase Firestore & Firebase Auth
- **Market Data**: Bitget & Binance Public APIs with rate-limit deduplication & caching
- **Mobile**: Capacitor Android (`@capacitor/android`)
- **Build Tooling**: Vite 6, Tailwind CSS v4

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Configure environment variables by copying `.env.example`:

```bash
cp .env.example .env
```

3. Start the development server:

```bash
npm run dev
```

The application will be accessible at `http://localhost:3000`.

---

## Build & Deployment

### Web Build

To compile the React frontend and bundle the Express server for production:

```bash
npm run build
```

To start the production server:

```bash
npm run start
```

### Mobile Build (Android)

To sync the web build to the Capacitor Android project:

```bash
npx cap sync android
```

---

## License

Private / Proprietary.
