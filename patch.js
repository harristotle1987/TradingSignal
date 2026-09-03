const fs = require('fs');
let code = fs.readFileSync('src/server/routes/signals.ts', 'utf8');

const target = `  try {
    // Directly invoke Market Scan Engine as the single automated scan trigger
    logger.info(\`[Scanner Trigger] MARKET_SCAN_ENGINE_START | triggerTime: \${Date.now()}\`);
    const scanEngineStartTime = Date.now();
    const result = await hourlyScanner.triggerAutomatedScan(true, requestStartTime);
    const scanEngineDurationMs = Date.now() - scanEngineStartTime;
    logger.info(\`[Scanner Trigger] MARKET_SCAN_ENGINE_END | duration: \${scanEngineDurationMs}ms | status: \${result.status} | candidates: \${result.candidatesEvaluated} | accepted: \${result.acceptedSignalsCount}\`);

    let statusLog = '';
    if (result.status === 'COMPLETED') {
      logger.info('EXTERNAL_HOURLY_SCAN_COMPLETED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_COMPLETED';
    } else if (result.status === 'SKIPPED_CAP_REACHED' || result.status === 'SCAN_ALREADY_RUNNING') {
      logger.info('EXTERNAL_HOURLY_SCAN_SKIPPED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_SKIPPED';
    } else {
      logger.error('EXTERNAL_HOURLY_SCAN_FAILED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_FAILED';
    }

    const settings = ScannerPersistence.getSettings();
    const capState = result.capState || await ScannerPersistence.getCapState();
    const intervalMinutes = [15, 30, 45, 60].includes(Number(settings.intervalMinutes))
      ? Number(settings.intervalMinutes)
      : 15;
    const lastAutomatedScan = capState.lastAutomatedScan || capState.lastScanTime || 0;
    
    // Refresh cron status completely in the background without blocking the scanner trigger API
    CronJobOrgService.getJobStatus(false).catch((err) => {
      logger.debug('[Scanner Route] Background cron status update deferred', { error: String(err) });
    });

    const cachedCron = CronJobOrgService.getCachedStatus();
    const nextCronExecution = cachedCron?.nextExecution?.timestamp || (lastAutomatedScan + intervalMinutes * 60 * 1000);
    const nextScanTime = nextCronExecution;

    const httpCode = result.status === 'ERROR' ? 500 : 200;
    const durationMs = result.scanDurationMs ?? (Date.now() - now);
    const totalRequestDurationMs = Date.now() - requestStartTime;
    logger.info(\`[Scanner Trigger] TOTAL_DURATION | duration: \${totalRequestDurationMs}ms | scanEngineDuration: \${durationMs}ms\`);

    // Fast, lightweight HTTP response for cron scheduler with complete state metrics
    res.status(httpCode).json({
      success: result.success,
      status: result.status,
      message: result.message,
      timestamp: result.timestamp || Date.now(),
      lastCronExecution: now,
      lastAutomatedScan,
      lastScanCompletedAt: capState.lastScanCompletedAt || Date.now(),
      lastScanDuration: durationMs,
      universeSymbolsScanned: result.universeSymbolsScanned ?? capState.universeSymbolsScanned ?? 0,
      preliminaryCandidatesFound: result.preliminaryCandidatesFound ?? capState.preliminaryCandidatesFound ?? 0,
      candidatesRejectedPreliminary: result.candidatesRejectedPreliminary ?? capState.candidatesRejectedPreliminary ?? 0,
      candidatesEvaluated: result.candidatesEvaluated ?? capState.candidatesEvaluated ?? 0,
      candidatesRejectedFinal: result.candidatesRejectedFinal ?? capState.candidatesRejectedFinal ?? (result.rejectedCount ?? 0),
      signalsGenerated: result.signalsGenerated ?? result.signalsFound ?? capState.signalsGenerated ?? 0,
      signalsAccepted: result.signalsAccepted ?? result.acceptedSignalsCount ?? capState.signalsAccepted ?? 0,
      lastCandidatesEvaluated: result.candidatesEvaluated ?? capState.lastCandidatesEvaluated ?? 0,
      lastSignalsFound: result.signalsFound ?? result.acceptedSignalsCount ?? capState.lastSignalsFound ?? 0,
      lastAcceptedSignals: result.acceptedSignalsCount ?? capState.lastAcceptedSignals ?? 0,
      signalsFound: result.signalsFound ?? result.acceptedSignalsCount ?? capState.lastSignalsFound ?? 0,
      acceptedSignalsCount: result.acceptedSignalsCount ?? capState.lastAcceptedSignals ?? 0,
      nextCronExecution,
      lastScanTime: lastAutomatedScan,
      nextScanTime,
      intervalMinutes,
      rejectedCount: result.rejectedCount ?? 0,
      candidatesRejectedBeforeMTF: result.candidatesRejectedBeforeMTF ?? 0,
      candidatesRejectedByMTF: result.candidatesRejectedByMTF ?? 0,
      candidatesRejectedByScore: result.candidatesRejectedByScore ?? 0,
      candidatesRejectedByRR: result.candidatesRejectedByRR ?? 0,
      candidatesRejectedByStructure: result.candidatesRejectedByStructure ?? 0,
      rejectionReasons: result.rejectionReasons ?? [],
      rejectionReasonsCounts: result.rejectionReasonsCounts ?? result.rejectionReasonsAggregated ?? {},
      candidateRejectionDetails: result.candidateRejectionDetails ?? [],
      diagnosticsCount: result.diagnosticsCount ?? 0,
      diagnostics: result.diagnostics ?? [],
      scanDurationMs: durationMs,
      scanDuration: \`\${(durationMs / 1000).toFixed(2)}s\`,
      totalDurationMs: totalRequestDurationMs,
      globalScanStartMs: result.globalScanStartMs ?? requestStartTime,
      globalScanDeadlineMs: result.globalScanDeadlineMs ?? (requestStartTime + 24000),
      currentElapsedMs: result.currentElapsedMs ?? (Date.now() - requestStartTime),
      remainingBudgetMs: result.remainingBudgetMs ?? Math.max(0, (requestStartTime + 24000) - Date.now()),
      gate6ElapsedMs: result.gate6ElapsedMs ?? 0,
      stage3ElapsedMs: result.stage3ElapsedMs ?? 0,
      timeBudgetExceeded: result.timeBudgetExceeded ?? false,
      providerRequestsStoppedByBudget: result.providerRequestsStoppedByBudget ?? false,
      timingTelemetry: result.timingTelemetry,
      external_hourly_scan_status: statusLog
    });`;

const replacement = `  try {
    const { serverConfig } = await import('../config.js');
    
    // 2. Perform existing daily-cap, lock, and duplicate-run checks exactly as now
    if (process.env.NODE_ENV === 'production' && !ScannerPersistence.isProductionPersistenceReady()) {
      return res.status(200).json({
        success: false,
        status: 'PERSISTENCE_UNAVAILABLE_DEGRADED',
        message: 'REJECTED: PRODUCTION_PERSISTENCE_UNAVAILABLE. Firebase Service Account required for automated scanner dispatch in production.',
        timestamp: Date.now()
      });
    }

    const instanceId = Math.random().toString(36).substring(2, 9);
    const lockResult = await ScannerPersistence.tryAcquireLock(instanceId);
    if (!lockResult.acquired) {
      return res.status(200).json({
        success: false,
        status: 'SCAN_ALREADY_RUNNING',
        message: 'REJECTED: SCAN_ALREADY_RUNNING. Another scan cycle is currently in progress.',
        timestamp: Date.now()
      });
    }
    // Release immediately to allow background scan to acquire it
    await ScannerPersistence.releaseLock(instanceId);

    const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
    const dailyCap = capState.dailySignalCap || serverConfig.getConfig().thresholds.dailySignalCap;
    
    if (capState.dailySignalCount >= dailyCap) {
      return res.status(200).json({
        success: true,
        status: 'SKIPPED_CAP_REACHED',
        message: \`REJECTED: DAILY_CAP_REACHED. Daily automated signal cap reached (\${capState.dailySignalCount}/\${dailyCap}). Preserving risk limits.\`,
        timestamp: Date.now()
      });
    }

    // 3. Dispatch hourlyScanner.triggerAutomatedScan(...) without awaiting the full scan
    logger.info(\`[Scanner Trigger] MARKET_SCAN_ENGINE_START | triggerTime: \${Date.now()}\`);
    hourlyScanner.triggerAutomatedScan(true, requestStartTime).catch(err => {
      logger.error('[Scanner Route] Background scan error:', { error: String(err) });
    });

    const settings = ScannerPersistence.getSettings();
    const intervalMinutes = [15, 30, 45, 60].includes(Number(settings.intervalMinutes))
      ? Number(settings.intervalMinutes)
      : 15;
    const lastAutomatedScan = capState.lastAutomatedScan || capState.lastScanTime || 0;
    
    // Refresh cron status completely in the background without blocking the scanner trigger API
    CronJobOrgService.getJobStatus(false).catch((err) => {
      logger.debug('[Scanner Route] Background cron status update deferred', { error: String(err) });
    });

    const cachedCron = CronJobOrgService.getCachedStatus();
    const nextCronExecution = cachedCron?.nextExecution?.timestamp || (lastAutomatedScan + intervalMinutes * 60 * 1000);
    const nextScanTime = nextCronExecution;

    const totalRequestDurationMs = Date.now() - requestStartTime;
    logger.info(\`[Scanner Trigger] TOTAL_DURATION | duration: \${totalRequestDurationMs}ms | status: DISPATCHED\`);

    // 4. Immediately return the existing "DISPATCHED" response/status
    res.status(202).json({
      success: true,
      status: 'DISPATCHED',
      message: 'Scan dispatched in background',
      timestamp: Date.now(),
      lastCronExecution: now,
      lastAutomatedScan,
      lastScanCompletedAt: capState.lastScanCompletedAt || Date.now(),
      lastScanDuration: capState.lastScanDuration || 0,
      universeSymbolsScanned: capState.universeSymbolsScanned ?? 0,
      preliminaryCandidatesFound: capState.preliminaryCandidatesFound ?? 0,
      candidatesRejectedPreliminary: capState.candidatesRejectedPreliminary ?? 0,
      candidatesEvaluated: capState.candidatesEvaluated ?? 0,
      candidatesRejectedFinal: capState.candidatesRejectedFinal ?? 0,
      signalsGenerated: capState.signalsGenerated ?? 0,
      signalsAccepted: capState.signalsAccepted ?? 0,
      lastCandidatesEvaluated: capState.lastCandidatesEvaluated ?? 0,
      lastSignalsFound: capState.lastSignalsFound ?? 0,
      lastAcceptedSignals: capState.lastAcceptedSignals ?? 0,
      signalsFound: capState.lastSignalsFound ?? 0,
      acceptedSignalsCount: capState.lastAcceptedSignals ?? 0,
      nextCronExecution,
      lastScanTime: lastAutomatedScan,
      nextScanTime,
      intervalMinutes,
      totalDurationMs: totalRequestDurationMs,
      external_hourly_scan_status: 'EXTERNAL_HOURLY_SCAN_DISPATCHED'
    });`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/server/routes/signals.ts', code);
    console.log("Replaced successfully!");
} else {
    console.log("Target not found!");
}
