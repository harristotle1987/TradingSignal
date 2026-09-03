import re

with open('src/server/routes/signals.ts', 'r') as f:
    code = f.read()

match = re.search(r"    // 3\. Dispatch hourlyScanner\.triggerAutomatedScan.*?external_hourly_scan_status: 'EXTERNAL_HOURLY_SCAN_DISPATCHED'\n    \}\);", code, re.DOTALL)
if match:
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

    const scanDuration = typeof (scanResult as any).scanDurationMs === 'number' 
      ? `${((scanResult as any).scanDurationMs / 1000).toFixed(2)}s` 
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
    code = code[:match.start()] + replacement + code[match.end():]
    with open('src/server/routes/signals.ts', 'w') as f:
        f.write(code)
    print("Patched routes/signals.ts successfully!")
else:
    print("Pattern not found in routes/signals.ts!")

