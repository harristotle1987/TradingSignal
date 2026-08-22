import { getFirestoreAdmin } from './src/server/firebaseAdmin.js';
import * as dotenv from 'dotenv';
dotenv.config();

async function chunkedDelete(collectionName: string) {
  const firestore = getFirestoreAdmin();
  if (!firestore) {
    console.log('No firestore configured.');
    return;
  }
  const snapshot = await firestore.collection(collectionName).get();
  console.log(`Found ${snapshot.size} documents in ${collectionName}`);
  let count = 0;
  let batch = firestore.batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = firestore.batch();
    }
  }
  if (count % 400 !== 0) {
    await batch.commit();
  }
  console.log(`Deleted ${count} documents from ${collectionName}`);
}

async function run() {
  await chunkedDelete('trading_signals');
  await chunkedDelete('signal_notifications');
  await chunkedDelete('signal_logs');
  await chunkedDelete('rejected_candidates');
}

run().catch(console.error);
