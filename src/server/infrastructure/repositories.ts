/**
 * Provider-Neutral Repository Interfaces & Factory Registry
 *
 * Business logic interacts strictly with these repository interfaces.
 * Implementations (Firebase, In-Memory, etc.) are injected through this registry.
 */

import {
  User,
  Session,
  Signal,
  SignalOutcome,
  HistoricalTrade,
  AuditEvent,
  ScannerState,
} from './types.js';

export interface IAuthRepository {
  verifyToken(token: string): Promise<{ valid: boolean; user?: User; error?: string }>;
  createSession(userId: string, ttlMs?: number): Promise<Session>;
  revokeSession(sessionId: string): Promise<void>;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ISessionRepository {
  findById(id: string): Promise<Session | null>;
  findByToken(token: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  deleteExpired(): Promise<number>;
}

export interface ISignalRepository {
  save(signal: Signal): Promise<{ success: boolean; error?: string }>;
  findById(id: string): Promise<Signal | null>;
  findActive(): Promise<Signal[]>;
  findAll(limit?: number): Promise<Signal[]>;
  updateStatus(id: string, status: string, metadata?: Partial<Signal>): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ISignalOutcomeRepository {
  save(outcome: SignalOutcome): Promise<void>;
  findById(id: string): Promise<SignalOutcome | null>;
  findAll(limit?: number): Promise<SignalOutcome[]>;
  findBySymbol(symbol: string): Promise<SignalOutcome[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface IHistoricalTradeRepository {
  save(trade: HistoricalTrade): Promise<void>;
  findAll(limit?: number): Promise<HistoricalTrade[]>;
  findBySymbol(symbol: string): Promise<HistoricalTrade[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface IAuditEventRepository {
  log(event: AuditEvent): Promise<void>;
  findRecent(limit?: number): Promise<AuditEvent[]>;
  clear(): Promise<void>;
}

export interface IScannerStateRepository {
  getCapState(dateStr: string): Promise<ScannerState | null>;
  saveCapState(state: ScannerState): Promise<void>;
  acquireLock(instanceId: string, ttlMs: number): Promise<boolean>;
  releaseLock(instanceId: string): Promise<void>;
}

export interface RepositoryContainer {
  auth: IAuthRepository;
  user: IUserRepository;
  session: ISessionRepository;
  signal: ISignalRepository;
  signalOutcome: ISignalOutcomeRepository;
  historicalTrade: IHistoricalTradeRepository;
  auditEvent: IAuditEventRepository;
  scannerState: IScannerStateRepository;
}

let activeRepositories: RepositoryContainer | null = null;

export function setRepositories(container: RepositoryContainer): void {
  activeRepositories = container;
}

export function getRepositories(): RepositoryContainer {
  if (!activeRepositories) {
    throw new Error(
      'Repositories not initialized. Call initializeRepositories() or setRepositories() before accessing persistence.'
    );
  }
  return activeRepositories;
}

export const getAuthRepository = () => getRepositories().auth;
export const getUserRepository = () => getRepositories().user;
export const getSessionRepository = () => getRepositories().session;
export const getSignalRepository = () => getRepositories().signal;
export const getSignalOutcomeRepository = () => getRepositories().signalOutcome;
export const getHistoricalTradeRepository = () => getRepositories().historicalTrade;
export const getAuditEventRepository = () => getRepositories().auditEvent;
export const getScannerStateRepository = () => getRepositories().scannerState;
