/**
 * Infrastructure Layer Entry Point
 *
 * Initializes and exports the repository container.
 * Business logic accesses data strictly via getSignalRepository(), getScannerStateRepository(), etc.
 */

import { setRepositories, getRepositories } from './repositories.js';
import { createFirebaseRepositories } from './firebase/FirebaseAdapter.js';
import { createMemoryRepositories } from './memory/MemoryAdapter.js';
import { isProductionPersistenceReady } from '../firebaseAdmin.js';
import { logger } from '../logger.js';

let initialized = false;

export function initializeInfrastructure(): void {
  if (initialized) return;

  const persistenceReady = isProductionPersistenceReady();
  if (persistenceReady || process.env.NODE_ENV === 'production') {
    logger.info('[Infrastructure] Initializing Firebase adapter repositories');
    setRepositories(createFirebaseRepositories());
  } else {
    logger.info('[Infrastructure] Initializing In-Memory adapter repositories');
    setRepositories(createMemoryRepositories());
  }
  initialized = true;
}

// Auto-initialize on import
initializeInfrastructure();

export * from './types.js';
export * from './repositories.js';
export { createFirebaseRepositories } from './firebase/FirebaseAdapter.js';
export { createMemoryRepositories } from './memory/MemoryAdapter.js';
