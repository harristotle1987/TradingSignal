# Trading Signal Platform

An automated cryptocurrency trading signal generator and market analytics engine. Built with React, TypeScript, Express, and Firebase, featuring multi-timeframe analysis, risk-managed signal scoring, and cross-platform mobile support via Capacitor.

---

## Key Features

- **Automated Market Scanner**: Periodically sweeps cryptocurrency markets across configurable intervals (15m, 30m, 45m, 60m).
- **High-Conviction Signal Engine**: Filters setups using multi-timeframe trend detection, momentum indicators, and risk/reward evaluation to generate structured Entry, Take Profit (TP), and Stop Loss (SL) levels.
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
