import { logger } from '../logger.js';
import { ScannerPersistence } from './ScannerPersistence.js';
import { SignalLogger } from './SignalLogger.js';
import { SignalValidator } from './SignalValidator.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { signalEngine } from './SignalEngine.js';

export class RepairService {
  /**
   * Scans and repairs all active signals and specific target signals (like INJUSDT)
   * on deployment/startup to enforce strict distinctness, ordering, and risk/reward.
   */
  public static async repairActiveSignals(): Promise<void> {
    logger.info('[RepairService] Starting active signals migration and repair scan...');

    try {
      // 1. Ensure Persistence layers are initialized
      ScannerPersistence.init();
      await SignalLogger.init();

      // Gather signals to examine
      const signalsToExamine: Array<{
        id: string;
        snapshotId: string;
        symbol: string;
        direction: 'BUY' | 'SELL';
        entryPrice: number;
        stopLoss: number;
        takeProfit: number;
        tp1?: number;
        tp2?: number;
        tp3?: number;
        status: string;
      }> = [];

      // Add from ScannerPersistence
      const localSent = ScannerPersistence.localData.sentSignals;
      for (const s of localSent) {
        // Enforce check on ACTIVE / WAITING_ENTRY or specifically the requested INJUSDT snapshot
        if (s.status === 'ACTIVE' || s.status === 'WAITING_ENTRY' || s.snapshotId === 'snap_1787008003492_INJUSDT_3gfn8' || s.symbol === 'INJUSDT') {
          signalsToExamine.push({
            id: s.id,
            snapshotId: s.snapshotId,
            symbol: s.symbol,
            direction: s.direction as 'BUY' | 'SELL',
            entryPrice: s.entryPrice,
            stopLoss: s.stopLoss,
            takeProfit: s.takeProfit,
            tp1: s.tp1,
            tp2: s.tp2,
            tp3: s.tp3,
            status: s.status,
          });
        }
      }

      // Add from SignalLogger if they aren't duplicate IDs
      const logRecords = await SignalLogger.getSignalLogs(500);
      for (const log of logRecords) {
        if (log.status === 'ACTIVE' || log.status === 'WAITING_ENTRY' || log.snapshotId === 'snap_1787008003492_INJUSDT_3gfn8' || log.symbol === 'INJUSDT') {
          if (!signalsToExamine.some((s) => s.id === log.id || s.snapshotId === log.snapshotId)) {
            signalsToExamine.push({
              id: log.id,
              snapshotId: log.snapshotId,
              symbol: log.symbol,
              direction: log.direction as 'BUY' | 'SELL',
              entryPrice: log.entryPrice,
              stopLoss: log.stopLoss,
              takeProfit: log.takeProfit,
              tp1: log.tp1,
              tp2: log.tp2,
              tp3: log.tp3,
              status: log.status,
            });
          }
        }
      }

      logger.info(`[RepairService] Found ${signalsToExamine.length} candidate active/target signals for evaluation.`);

      let repairedCount = 0;

      for (const sig of signalsToExamine) {
        // Check if TP is invalid or needs correction
        const needsRepair =
          sig.snapshotId === 'snap_1787008003492_INJUSDT_3gfn8' ||
          sig.tp1 === undefined ||
          sig.tp2 === undefined ||
          sig.tp3 === undefined ||
          sig.tp1 === sig.tp2 ||
          sig.tp2 === sig.tp3 ||
          sig.tp1 === sig.tp3 ||
          (sig.direction === 'BUY' && (sig.entryPrice >= sig.tp1 || sig.tp1 >= sig.tp2 || sig.tp2 >= sig.tp3)) ||
          (sig.direction === 'SELL' && (sig.entryPrice <= sig.tp1 || sig.tp1 <= sig.tp2 || sig.tp2 <= sig.tp3));

        if (needsRepair) {
          logger.info(`[RepairService] REPAIRING signal ${sig.symbol} (ID: ${sig.id}, Snapshot: ${sig.snapshotId}). TPs were [${sig.tp1}, ${sig.tp2}, ${sig.tp3}]`);

          // Fetch market ATR or use fallback
          let atr = 0;
          try {
            const candles = await marketDataManager.getCandles(sig.symbol, undefined, '1h', 50, false);
            if (candles && candles.length >= 14) {
              atr = TechnicalIndicators.calculateATR(candles, 14);
            }
          } catch (err) {
            logger.warn(`[RepairService] Failed to fetch 1H candles for ATR for ${sig.symbol}:`, err);
          }

          const precision = sig.entryPrice < 10 ? 5 : 2;
          if (!atr || isNaN(atr) || atr <= 0) {
            atr = sig.entryPrice * 0.015; // default fallback 1.5% ATR
          }

          // Force recalculation by providing duplicates to the validator
          const enforced = SignalValidator.validateAndEnforceTps(
            sig.direction,
            sig.entryPrice,
            sig.stopLoss,
            sig.takeProfit,
            sig.takeProfit,
            sig.takeProfit,
            atr,
            precision
          );

          // Update ScannerPersistence
          await ScannerPersistence.updateSignalTps(
            sig.id,
            sig.id,
            enforced.tp1,
            enforced.tp2,
            enforced.tp3,
            enforced.takeProfit,
            enforced.riskRewardRatio
          );
          if (sig.snapshotId) {
            await ScannerPersistence.updateSignalTps(
              sig.id,
              sig.snapshotId,
              enforced.tp1,
              enforced.tp2,
              enforced.tp3,
              enforced.takeProfit,
              enforced.riskRewardRatio
            );
          }

          // Update SignalLogger
          await SignalLogger.updateTps(
            sig.id,
            enforced.tp1,
            enforced.tp2,
            enforced.tp3,
            enforced.takeProfit,
            enforced.riskRewardRatio
          );
          if (sig.snapshotId) {
            await SignalLogger.updateTps(
              sig.snapshotId,
              enforced.tp1,
              enforced.tp2,
              enforced.tp3,
              enforced.takeProfit,
              enforced.riskRewardRatio
            );
          }

          // Update in-memory SignalEngine if present
          const inMem = signalEngine.activeSignals.get(sig.symbol);
          if (inMem && (inMem.snapshotId === sig.snapshotId || inMem.id === sig.id)) {
            inMem.tp1 = enforced.tp1;
            inMem.tp2 = enforced.tp2;
            inMem.tp3 = enforced.tp3;
            inMem.takeProfit = enforced.takeProfit;
            inMem.riskRewardRatio = enforced.riskRewardRatio;
            logger.info(`[RepairService] Corrected in-memory SignalEngine active signal cache for ${sig.symbol}`);
          }

          logger.info(`[RepairService] REPAIRED signal ${sig.symbol}. New TPs: [${enforced.tp1}, ${enforced.tp2}, ${enforced.tp3}], R:R: ${enforced.riskRewardRatio}`);
          repairedCount++;
        }
      }

      // If we repaired any signals, make sure to clear the signalEngine signals memory cache so they reload from corrected disk
      if (repairedCount > 0) {
        signalEngine.clearSignals();
        logger.info(`[RepairService] Cleared SignalEngine in-memory cache to force-reload corrected signals on next demand.`);
      }

      logger.info(`[RepairService] Active signals scan and repair completed. Repaired ${repairedCount} signals.`);
    } catch (err) {
      logger.error('[RepairService] Error during active signals repair scan:', err);
    }
  }
}
