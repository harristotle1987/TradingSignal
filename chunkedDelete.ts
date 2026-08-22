export async function deleteQueryInChunks(firestore: any, collectionName: string) {
  const query = await firestore.collection(collectionName).get();
  let count = 0;
  let batch = firestore.batch();
  for (const doc of query.docs) {
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
}
