/**
 * Infrastructure Layer Entry Point
 *
 * Initializes and exports the Neon PostgreSQL repository container.
 * Business logic accesses data strictly via getSignalRepository(), getScannerStateRepository(), etc.
 */

import { setRepositories, getRepositories } from './repositories.js';
import { createNeonRepositories } from './neon/NeonAdapter.js';
import { createMemoryRepositories } from './memory/MemoryAdapter.js';
import { initializeNeonSchema, getNeonPool } from './neon/db.js';
import { logger } from '../logger.js';

let initialized = false;

export function initializeInfrastructure(): void {
  if (initialized) return;

  const dbUrl = process.env.DATABASE_URL?.trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (dbUrl || isProd) {
    logger.info('[Infrastructure] Initializing Neon PostgreSQL adapter repositories');
    setRepositories(createNeonRepositories());
    if (dbUrl) {
      initializeNeonSchema().catch((err) => {
        logger.error('[Infrastructure] Failed background Neon schema initialization:', { error: String(err) });
      });
    }
  } else {
    logger.info('[Infrastructure] Initializing In-Memory adapter repositories for development');
    setRepositories(createMemoryRepositories());
  }
  initialized = true;
}

// Auto-initialize on import
initializeInfrastructure();

export * from './types.js';
export * from './repositories.js';
export { createNeonRepositories } from './neon/NeonAdapter.js';
export { createMemoryRepositories } from './memory/MemoryAdapter.js';
