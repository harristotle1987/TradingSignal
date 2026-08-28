/**
 * Bounded Concurrency Limiter
 * Replaces unrestricted Promise.all calls with a concurrency limiter (default CONCURRENCY = 8).
 */

export function pLimit(concurrency: number = 8) {
  if (concurrency < 1) {
    throw new TypeError('Concurrency limit must be at least 1');
  }

  const queue: (() => void)[] = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const task = queue.shift();
      if (task) task();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount++;
        fn()
          .then((value) => {
            resolve(value);
            next();
          })
          .catch((err) => {
            reject(err);
            next();
          });
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

/**
 * Executes array mapping with bounded concurrency.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, index) => limit(() => fn(item, index))));
}
