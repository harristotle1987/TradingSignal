/**
 * Provider-Neutral Domain Models
 *
 * These models are decoupled from any underlying database or cloud provider (Firebase, PostgreSQL, etc.).
 * No Firestore/Firebase types (DocumentSnapshot, QuerySnapshot, FieldValue, Timestamp) are permitted here.
 */

import { PersistedSentSignal } from '../signals/ScannerPersistence.js';
import { SignalOutcomeRecord } from '../signals/SignalOutcomeLogger.js';

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  displayName?: string;
  createdAt: number;
  lastLoginAt?: number;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: number;
  createdAt: number;
  isValid: boolean;
  clientIp?: string;
  userAgent?: string;
}

export type Signal = PersistedSentSignal;

export type SignalOutcome = SignalOutcomeRecord;

export interface HistoricalTrade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  outcome: string;
  pnl?: number;
  rMultiple?: number;
  enteredAt: number;
  closedAt?: number;
  strategy?: string;
  timeframe?: string;
  rankTier?: string;
  score?: number;
}

export interface AuditEvent {
  id: string;
  securityId: string;
  action: string;
  timestamp: number;
  severity?: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
  details?: Record<string, unknown>;
  clientIp?: string;
  userId?: string;
}

export interface ScannerState {
  date: string;
  dailySignalCount: number;
  dailySignalCap: number;
  lastScanTime?: number;
  lastCronExecution?: number;
  lastAutomatedScan?: number;
  lastScanCompletedAt?: number;
  lastScanDuration?: number;
  lastCandidatesEvaluated?: number;
  lastSignalsFound?: number;
  lastAcceptedSignals?: number;
  nextCronExecution?: number;
  universeSymbolsScanned?: number;
  preliminaryCandidatesFound?: number;
  deepCandidatesEvaluated?: number;
  mtfConfirmedCount?: number;
  riskValidatedCount?: number;
}
