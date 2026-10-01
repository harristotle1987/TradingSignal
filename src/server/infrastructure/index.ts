/**
 * Infrastructure Layer Entry Point
 *
 * Initializes and exports the Neon PostgreSQL repository container.
 * Business logic accesses data strictly via getSignalRepository(), getScannerStateRepository(), etc.
 */

import { setRepositories, getRepositories } from './repositories.js';
import { createNeonRepositories } from './neon/NeonAdapter.js';
import { createMemoryRepositories } from './memory/MemoryAdapter.js';
import { initializeNeonSchema, getNeonPool, verifyRequiredProductionTables, REQUIRED_PRODUCTION_TABLES } from './neon/db.js';
import { logger } from '../logger.js';

let initialized = false;

export function initializeInfrastructure(): void {
  if (initialized) return;

  const dbUrl = process.env.DATABASE_URL?.trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (dbUrl || isProd) {
    logger.info('[Infrastructure] Initializing Neon PostgreSQL adapter repositories');
    setRepositories(createNeonRepositories());
  } else {
    logger.info('[Infrastructure] Initializing In-Memory adapter repositories for development');
    setRepositories(createMemoryRepositories());
  }
  initialized = true;
}

/**
 * Production Readiness Check (Gate 5):
 * Explicitly verifies all required production tables exist in Neon PostgreSQL before accepting traffic.
 * Prevents unawaited, silent partial migrations in the background.
 */
export async function verifyProductionReadiness(): Promise<{
  ready: boolean;
  missingTables: string[];
  error?: string;
}> {
  const isProd = process.env.NODE_ENV === 'production';
  const dbUrl = process.env.DATABASE_URL?.trim();

  if (!isProd && !dbUrl) {
    return { ready: true, missingTables: [] };
  }

  const { ready, missingTables } = await verifyRequiredProductionTables();
  if (!ready) {
    const errMsg = `Production database readiness check failed: Missing required database tables [${missingTables.join(', ')}]. Migrations must succeed before the deployment is considered ready.`;
    logger.error(`[Infrastructure] ${errMsg}`);
    return { ready: false, missingTables, error: errMsg };
  }

  logger.info('[Infrastructure] Production database readiness verified: all required tables exist.');
  return { ready: true, missingTables: [] };
}

// Synchronous repository setup on module import (no background schema creation race)
initializeInfrastructure();

export * from './types.js';
export * from './repositories.js';
export { createNeonRepositories } from './neon/NeonAdapter.js';
export { createMemoryRepositories } from './memory/MemoryAdapter.js';
export { verifyRequiredProductionTables, initializeNeonSchema, REQUIRED_PRODUCTION_TABLES } from './neon/db.js';
