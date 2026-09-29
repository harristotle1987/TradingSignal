/**
 * In-Memory Adapter Implementation of Repository Interfaces
 *
 * Provides fast, isolated, in-memory repositories for development, unit testing, and fallback.
 */

import {
  User,
  Session,
  Signal,
  SignalOutcome,
  HistoricalTrade,
  AuditEvent,
  ScannerState,
} from '../types.js';
import {
  IAuthRepository,
  IUserRepository,
  ISessionRepository,
  ISignalRepository,
  ISignalOutcomeRepository,
  IHistoricalTradeRepository,
  IAuditEventRepository,
  IScannerStateRepository,
  RepositoryContainer,
} from '../repositories.js';

export class MemoryUserRepository implements IUserRepository {
  private users = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const clean = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase().trim() === clean) return u;
    }
    return null;
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, { ...user });
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }

  clear(): void {
    this.users.clear();
  }
}

export class MemorySessionRepository implements ISessionRepository {
  private sessions = new Map<string, Session>();

  async findById(id: string): Promise<Session | null> {
    return this.sessions.get(id) || null;
  }

  async findByToken(token: string): Promise<Session | null> {
    for (const s of this.sessions.values()) {
      if (s.token === token && s.isValid && s.expiresAt > Date.now()) {
        return s;
      }
    }
    return null;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async deleteExpired(): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, s] of this.sessions.entries()) {
      if (s.expiresAt <= now || !s.isValid) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.sessions.clear();
  }
}

export class MemoryAuthRepository implements IAuthRepository {
  constructor(
    private userRepo: IUserRepository,
    private sessionRepo: ISessionRepository
  ) {}

  async verifyToken(token: string): Promise<{ valid: boolean; user?: User; error?: string }> {
    const session = await this.sessionRepo.findByToken(token);
    if (!session) {
      return { valid: false, error: 'Invalid or expired session token' };
    }
    const user = await this.userRepo.findById(session.userId);
    if (!user) {
      return { valid: false, error: 'User associated with session not found' };
    }
    return { valid: true, user };
  }

  async createSession(userId: string, ttlMs = 24 * 60 * 60 * 1000): Promise<Session> {
    const session: Session = {
      id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      token: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      isValid: true,
    };
    await this.sessionRepo.save(session);
    return session;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sessionRepo.delete(sessionId);
  }
}

export class MemorySignalRepository implements ISignalRepository {
  private signals = new Map<string, Signal>();

  async save(signal: Signal): Promise<{ success: boolean; error?: string }> {
    this.signals.set(signal.id, { ...signal });
    return { success: true };
  }

  async findById(id: string): Promise<Signal | null> {
    return this.signals.get(id) || null;
  }

  async findActive(): Promise<Signal[]> {
    const active: Signal[] = [];
    for (const s of this.signals.values()) {
      if (
        s.status === 'ACTIVE' ||
        s.status === 'TP1_HIT' ||
        s.status === 'TP2_HIT' ||
        s.status === 'WAITING_ENTRY'
      ) {
        active.push(s);
      }
    }
    return active.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  async findAll(limit = 100): Promise<Signal[]> {
    return Array.from(this.signals.values())
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);
  }

  async updateStatus(id: string, status: string, metadata?: Partial<Signal>): Promise<void> {
    const existing = this.signals.get(id);
    if (existing) {
      existing.status = status as any;
      if (metadata) {
        Object.assign(existing, metadata);
      }
      this.signals.set(id, existing);
    }
  }

  async delete(id: string): Promise<void> {
    this.signals.delete(id);
  }

  async clear(): Promise<void> {
    this.signals.clear();
  }
}

export class MemorySignalOutcomeRepository implements ISignalOutcomeRepository {
  private outcomes = new Map<string, SignalOutcome>();

  async save(outcome: SignalOutcome): Promise<void> {
    this.outcomes.set(outcome.id, { ...outcome });
  }

  async findById(id: string): Promise<SignalOutcome | null> {
    return this.outcomes.get(id) || null;
  }

  async findAll(limit = 200): Promise<SignalOutcome[]> {
    return Array.from(this.outcomes.values())
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);
  }

  async findBySymbol(symbol: string): Promise<SignalOutcome[]> {
    const clean = symbol.toUpperCase().trim();
    return Array.from(this.outcomes.values())
      .filter((o) => (o.symbol || '').toUpperCase().trim() === clean)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  async delete(id: string): Promise<void> {
    this.outcomes.delete(id);
  }

  async clear(): Promise<void> {
    this.outcomes.clear();
  }
}

export class MemoryHistoricalTradeRepository implements IHistoricalTradeRepository {
  private trades = new Map<string, HistoricalTrade>();

  async save(trade: HistoricalTrade): Promise<void> {
    this.trades.set(trade.id, { ...trade });
  }

  async findAll(limit = 200): Promise<HistoricalTrade[]> {
    return Array.from(this.trades.values())
      .sort((a, b) => (b.enteredAt || 0) - (a.enteredAt || 0))
      .slice(0, limit);
  }

  async findBySymbol(symbol: string): Promise<HistoricalTrade[]> {
    const clean = symbol.toUpperCase().trim();
    return Array.from(this.trades.values())
      .filter((t) => t.symbol.toUpperCase().trim() === clean)
      .sort((a, b) => (b.enteredAt || 0) - (a.enteredAt || 0));
  }

  async delete(id: string): Promise<void> {
    this.trades.delete(id);
  }

  async clear(): Promise<void> {
    this.trades.clear();
  }
}

export class MemoryAuditEventRepository implements IAuditEventRepository {
  private events: AuditEvent[] = [];

  async log(event: AuditEvent): Promise<void> {
    this.events.push({ ...event });
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
  }

  async findRecent(limit = 50): Promise<AuditEvent[]> {
    return [...this.events].reverse().slice(0, limit);
  }

  async clear(): Promise<void> {
    this.events = [];
  }
}

export class MemoryScannerStateRepository implements IScannerStateRepository {
  private capStates = new Map<string, ScannerState>();
  private activeLock: { instanceId: string; expiresAt: number } | null = null;

  async getCapState(dateStr: string): Promise<ScannerState | null> {
    return this.capStates.get(dateStr) || null;
  }

  async saveCapState(state: ScannerState): Promise<void> {
    this.capStates.set(state.date, { ...state });
  }

  async acquireLock(instanceId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    if (this.activeLock && now < this.activeLock.expiresAt && this.activeLock.instanceId !== instanceId) {
      return false;
    }
    this.activeLock = {
      instanceId,
      expiresAt: now + ttlMs,
    };
    return true;
  }

  async releaseLock(instanceId: string): Promise<void> {
    if (this.activeLock && this.activeLock.instanceId === instanceId) {
      this.activeLock = null;
    }
  }

  clear(): void {
    this.capStates.clear();
    this.activeLock = null;
  }
}

export function createMemoryRepositories(): RepositoryContainer {
  const user = new MemoryUserRepository();
  const session = new MemorySessionRepository();
  const auth = new MemoryAuthRepository(user, session);
  const signal = new MemorySignalRepository();
  const signalOutcome = new MemorySignalOutcomeRepository();
  const historicalTrade = new MemoryHistoricalTradeRepository();
  const auditEvent = new MemoryAuditEventRepository();
  const scannerState = new MemoryScannerStateRepository();

  return {
    auth,
    user,
    session,
    signal,
    signalOutcome,
    historicalTrade,
    auditEvent,
    scannerState,
  };
}
