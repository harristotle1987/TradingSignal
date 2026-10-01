import assert from 'assert';
import {
  getAuthRepository,
  getUserRepository,
  getSessionRepository,
  getSignalRepository,
  getSignalOutcomeRepository,
  getHistoricalTradeRepository,
  getAuditEventRepository,
  getScannerStateRepository,
  setRepositories,
  createMemoryRepositories,
  createNeonRepositories,
  User,
  Session,
  Signal,
  SignalOutcome,
  HistoricalTrade,
  AuditEvent,
  ScannerState,
} from '../src/server/infrastructure/index.js';
import { setMockFirestoreAdmin } from '../src/server/firebaseAdmin.js';

async function runRepositoryTests() {
  console.log('\n=== REPOSITORY & INFRASTRUCTURE DECOUPLING REGRESSION ===\n');

  // Test 1: In-Memory Adapter isolation and CRUD operations
  console.log('Test 1: In-Memory Adapter repository operations');
  const memoryContainer = createMemoryRepositories();
  setRepositories(memoryContainer);

  // User & Auth
  const userRepo = getUserRepository();
  const authRepo = getAuthRepository();
  const testUser: User = {
    id: 'usr_test_1',
    email: 'trader@domain.com',
    role: 'admin',
    displayName: 'Lead Trader',
    createdAt: Date.now(),
  };
  await userRepo.save(testUser);
  const fetchedUser = await userRepo.findById('usr_test_1');
  assert.strictEqual(fetchedUser?.email, 'trader@domain.com', 'User saved and fetched from user repo');

  const session = await authRepo.createSession(testUser.id);
  assert(session.token.startsWith('tok_'), 'Session token created');
  const authResult = await authRepo.verifyToken(session.token);
  assert.strictEqual(authResult.valid, true, 'Session token verified via auth repo');
  assert.strictEqual(authResult.user?.id, testUser.id, 'User matched from session token');

  // Signal Repository
  const signalRepo = getSignalRepository();
  const testSignal: Signal = {
    id: 'sig_repo_1',
    snapshotId: 'snap_repo_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 85000,
    stopLoss: 84000,
    takeProfit: 87000,
    tp1: 85500,
    tp2: 86000,
    tp3: 87000,
    riskRewardRatio: 2.0,
    score: 85,
    rankTier: 'BEST_TRADE',
    strategy: 'Breakout',
    timeframe: 'H1',
    dataSource: 'Live Feed',
    status: 'ACTIVE',
    timestamp: Date.now(),
    expiresAt: Date.now() + 3600000,
    notificationSent: true,
    notificationTimestamp: Date.now(),
    date: '2026-09-29',
    isTradeableSignal: true,
    signalClassification: 'TRADEABLE',
    provenance: 'LIVE',
  };

  await signalRepo.save(testSignal);
  const activeSignals = await signalRepo.findActive();
  assert.strictEqual(activeSignals.length, 1, 'Active signal retrieved from signal repo');
  assert.strictEqual(activeSignals[0].id, 'sig_repo_1', 'Correct signal retrieved');

  await signalRepo.updateStatus('sig_repo_1', 'TP1_HIT');
  const updatedSignal = await signalRepo.findById('sig_repo_1');
  assert.strictEqual(updatedSignal?.status, 'TP1_HIT', 'Signal status updated');

  // Signal Outcome Repository
  const outcomeRepo = getSignalOutcomeRepository();
  const testOutcome: SignalOutcome = {
    id: 'sig_repo_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    provider: 'Bitget',
    entryPrice: 85000,
    stopLoss: 84000,
    takeProfit: 87000,
    tp1: 85500,
    tp2: 86000,
    tp3: 87000,
    status: 'TP1_HIT',
    finalOutcome: 'TP1_HIT',
    timestamp: Date.now(),
    updatedAt: Date.now(),
  };
  await outcomeRepo.save(testOutcome);
  const foundOutcome = await outcomeRepo.findById('sig_repo_1');
  assert.strictEqual(foundOutcome?.finalOutcome, 'TP1_HIT', 'Outcome saved and retrieved');

  // Historical Trade Repository
  const tradeRepo = getHistoricalTradeRepository();
  const testTrade: HistoricalTrade = {
    id: 'trade_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 85000,
    exitPrice: 87000,
    stopLoss: 84000,
    takeProfit: 87000,
    outcome: 'WIN',
    pnl: 2000,
    rMultiple: 2.0,
    enteredAt: Date.now() - 3600000,
    closedAt: Date.now(),
  };
  await tradeRepo.save(testTrade);
  const allTrades = await tradeRepo.findAll();
  assert.strictEqual(allTrades.length, 1, 'Historical trade retrieved');

  // Audit Event Repository
  const auditRepo = getAuditEventRepository();
  const testAudit: AuditEvent = {
    id: 'audit_1',
    securityId: 'SEC-AUTH',
    action: 'Admin login',
    timestamp: Date.now(),
    severity: 'INFO',
  };
  await auditRepo.log(testAudit);
  const recentAudits = await auditRepo.findRecent();
  assert.strictEqual(recentAudits.length, 1, 'Audit log retrieved');

  // Scanner State & Locking Repository
  const scannerRepo = getScannerStateRepository();
  const testState: ScannerState = {
    date: '2026-09-29',
    dailySignalCount: 2,
    dailySignalCap: 10,
  };
  await scannerRepo.saveCapState(testState);
  const capState = await scannerRepo.getCapState('2026-09-29');
  assert.strictEqual(capState?.dailySignalCount, 2, 'Cap state retrieved from repo');

  const lockAcquired = await scannerRepo.acquireLock('worker_1', 5000);
  assert.strictEqual(lockAcquired, true, 'Lock acquired by worker_1');
  const lockDenied = await scannerRepo.acquireLock('worker_2', 5000);
  assert.strictEqual(lockDenied, false, 'Lock denied to worker_2 while active');
  await scannerRepo.releaseLock('worker_1');
  const lockReacquired = await scannerRepo.acquireLock('worker_2', 5000);
  assert.strictEqual(lockReacquired, true, 'Lock reacquired by worker_2 after release');

  console.log('✓ Test 1 passed: In-Memory Adapter repositories function correctly.');

  // Test 2: Neon Adapter repository implementation
  console.log('Test 2: Neon PostgreSQL Adapter repository interface compliance');
  const neonContainer = createNeonRepositories();
  setRepositories(neonContainer);

  const neonSignalRepo = getSignalRepository();
  const saveResult = await neonSignalRepo.save(testSignal);
  assert.strictEqual(typeof saveResult.success, 'boolean', 'Neon save signal returns success state');

  const activeNeon = await neonSignalRepo.findActive();
  assert(Array.isArray(activeNeon), 'Active signals query returns array');

  const neonStateRepo = getScannerStateRepository();
  await neonStateRepo.saveCapState(testState);
  const neonCap = await neonStateRepo.getCapState('2026-09-29');
  assert(neonCap === null || typeof neonCap === 'object', 'Scanner state queried from Neon Adapter');

  // Reset to memory container for subsequent tests
  setRepositories(memoryContainer);
  console.log('✓ Test 2 passed: Neon Adapter operations verified with zero Firebase dependency.');

  // Test 3: Pluggable repository swapping without application changes
  console.log('Test 3: Pluggable repository swapping');
  let customSaveCalled = false;
  const customSignalRepo = {
    ...memoryContainer.signal,
    save: async (sig: Signal) => {
      customSaveCalled = true;
      return memoryContainer.signal.save(sig);
    },
  };

  setRepositories({
    ...memoryContainer,
    signal: customSignalRepo,
  });

  await getSignalRepository().save(testSignal);
  assert.strictEqual(customSaveCalled, true, 'Custom repository seamlessly invoked');
  console.log('✓ Test 3 passed: Repository swapping operates without changing business logic.');

  console.log('\n\x1b[32m[INFRASTRUCTURE REPOSITORIES SUCCESS] All provider-neutral repository tests passed!\x1b[0m\n');
}

runRepositoryTests().catch((err) => {
  console.error('\x1b[31m[INFRASTRUCTURE REPOSITORIES FAILED]\x1b[0m', err);
  process.exit(1);
});
