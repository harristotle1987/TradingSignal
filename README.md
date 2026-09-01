# Trading Signal Platform

An automated cryptocurrency trading signal generator and market analytics engine. Built with React, TypeScript, Express, and Firebase, featuring multi-timeframe analysis, risk-managed signal scoring, and cross-platform mobile support via Capacitor.

---

## Key Features

- **Automated Market Scanner**: Periodically sweeps cryptocurrency markets across configurable intervals (15m, 30m, 45m, 60m).
- **Institutional Strategy Pipeline**: Setups undergo rigorous phased evaluation:
  - **Gate 0 (Data Integrity)**: Strict OHLC geometry validation and price synchronization tracking.
  - **Gate 1 (Regime Detection)**: Identifies precise market states (e.g., `STRONG_BULL_TREND`, `BREAKOUT`) using comprehensive technical combinations (EMAs, ADX, Bollinger Band width, ATR).
  - **Gate 2 (MTF Confluence)**: Evaluates structural context aligning HTF (4H/1H), MTF (15M), and LTF (5M) trajectories.
  - **Gate 3 (Market Structure)**: Identifies Break of Structure (BOS), Change of Character (CHOCH), and verifies support/resistance alignments via fractal swings.
  - **Gate 4 (Momentum & Volatility)**: Gauges raw strength via RSI, MACD histograms, ADX/DMI alignment, and ensures sufficient market volatility via ATR and Bollinger Band expansions while filtering overextensions.
  - **Gate 5 (Support, Resistance & Liquidity)**: Clusters price points (swings, psychological levels, higher-timeframe boundaries) into defined Price Zones, calculating strength via overlap confluence. Detects liquidity sweeps and successful retests of flipped boundaries.
  - **Gate 6 (Volume & Price Action Confirmation)**: Validates institutional participation via relative volume expansion, On-Balance Volume (OBV) trend, and Daily VWAP alignment. Filters out 'ghost breakouts' lacking volume and rewards strong engulfing/wick-rejection candle behaviors.
  - **Gate 7 (Market Context)**: Adapts execution logic strictly to asset class constraints. Maps trades to the correct session (e.g., rejecting out-of-hours stock trades or illiquid Sydney forex sessions). Implements a defensive block for high-risk macroeconomic news events and maps broad asset correlations.
  - **Scoring Engine**: Evaluates Multi-Timeframe Trend, Momentum, Volatility Expansion, and Order Flow strategies.
- **Safety & Cap Governance**: Enforces a daily automated signal ceiling per UTC day to prevent over-trading and market exposure overflow.
- **Distributed Lock Management**: Uses Firestore document locking (`scanner/lock`) for atomic execution across serverless and containerized instances.
- **Market Diagnostics**: Live ticker monitoring, order book depth analytics, and multi-asset class scanners.
- **Cross-Platform Readiness**: Responsive web UI optimized for mobile viewports, bundled with Capacitor for native Android deployment.

---

## Architecture Overview

```
├── src/
│   ├── components/       # UI components (Signals, Scanner, Diagnostics, Settings)
│   ├── server/           # Express server logic
│   │   ├── market/       # Bitget API client, caching layer, ticker streams
│   │   ├── routes/       # API endpoints (/api/signals, /api/scanner, etc.)
│   │   └── signals/      # HourlyScanner, persistence, strategy performance tracker
│   ├── types/            # TypeScript interfaces and signal definitions
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
- **Market Data**: Bitget Public API with rate-limit deduplication & caching
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
