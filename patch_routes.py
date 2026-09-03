import re

with open('src/server/routes/signals.ts', 'r') as f:
    code = f.read()

# We need to replace the async dispatch logic with synchronous execution and exact return formatting
pattern = """    // 3. Dispatch hourlyScanner.triggerAutomatedScan(...) without awaiting the full scan
    logger.info(`[Scanner Trigger] MARKET_SCAN_ENGINE_START | triggerTime: ${Date.now()}`);
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
    logger.info(`[Scanner Trigger] TOTAL_DURATION | duration: ${totalRequestDurationMs}ms | status: DISPATCHED`);

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
    });"""

replacement = """    // 3. Execute hourlyScanner.triggerAutomatedScan(...) and await the full scan
    logger.info(`[Scanner Trigger] MARKET_SCAN_ENGINE_START | triggerTime: ${Date.now()}`);
    const scanResult = await hourlyScanner.triggerAutomatedScan(true, requestStartTime);

    const settings = ScannerPersistence.getSettings();
    const intervalMinutes = [15, 30, 45, 60].includes(Number(settings.intervalMinutes))
      ? Number(settings.intervalMinutes)
      : 15;
    
    const finalCapState = (scanResult as any).capState || capState;
    const lastAutomatedScan = finalCapState.lastAutomatedScan || finalCapState.lastScanTime || 0;
    
    // Refresh cron status completely in the background without blocking the scanner trigger API
    CronJobOrgService.getJobStatus(false).catch((err) => {
      logger.debug('[Scanner Route] Background cron status update deferred', { error: String(err) });
    });
    
    const cachedCron = CronJobOrgService.getCachedStatus();
    const nextCronExecution = cachedCron?.nextExecution?.timestamp || (lastAutomatedScan + intervalMinutes * 60 * 1000);
    const nextScanTime = nextCronExecution;
    const totalRequestDurationMs = Date.now() - requestStartTime;
    logger.info(`[Scanner Trigger] TOTAL_DURATION | duration: ${totalRequestDurationMs}ms | status: COMPLETED`);

    const scanDuration = typeof scanResult.scanDurationMs === 'number' 
      ? `${(scanResult.scanDurationMs / 1000).toFixed(2)}s` 
      : undefined;

    // 4. Return the full completed-scan JSON response exactly as expected
    const { capState: _, ...cleanedScanResult } = scanResult as any;

    res.status(200).json({
      ...cleanedScanResult,
      lastCronExecution: now,
      lastAutomatedScan,
      lastScanCompletedAt: finalCapState.lastScanCompletedAt || Date.now(),
      lastScanDuration: finalCapState.lastScanDuration || 0,
      lastCandidatesEvaluated: finalCapState.lastCandidatesEvaluated ?? 0,
      lastSignalsFound: finalCapState.lastSignalsFound ?? 0,
      lastAcceptedSignals: finalCapState.lastAcceptedSignals ?? 0,
      nextCronExecution,
      lastScanTime: lastAutomatedScan,
      nextScanTime,
      intervalMinutes,
      scanDuration,
      totalDurationMs: totalRequestDurationMs,
      external_hourly_scan_status: 'EXTERNAL_HOURLY_SCAN_COMPLETED'
    });"""

if pattern in code:
    code = code.replace(pattern, replacement)
    with open('src/server/routes/signals.ts', 'w') as f:
        f.write(code)
    print("Patched routes/signals.ts successfully!")
else:
    print("Pattern not found in routes/signals.ts!")

