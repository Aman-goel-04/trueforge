import type { Logger } from 'winston';
import { extractErrorLogFields } from './errorLogFields';

export class PromiseTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromiseTimeoutError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PromiseTimeoutError(label ? `Timed out after ${ms}ms (${label})` : `Timed out after ${ms}ms`)),
      ms,
    );
  });

  return Promise.race([p, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export async function* mergeAsyncGenerators<T>(
  generators: AsyncGenerator<T>[],
  logger: Logger,
): AsyncGenerator<T, void, unknown> {
  type PendingResult = { idx: number; result: IteratorResult<T, void> };
  const pending = new Map<number, Promise<PendingResult>>();

  const getNextIteration = (idx: number): Promise<PendingResult> => {
    const nextPromise = generators[idx]!.next().then(result => ({ idx, result }));
    nextPromise.catch(error => {
      logger.error(`Unexpected error in mergeAsyncGenerators generator ${idx}`, extractErrorLogFields(error));
    });
    return nextPromise;
  };

  for (let i = 0; i < generators.length; i++) {
    pending.set(i, getNextIteration(i));
  }

  while (pending.size > 0) {
    const { idx, result } = await Promise.race(pending.values());
    if (result.done) {
      pending.delete(idx);
      continue;
    }

    yield result.value;
    pending.set(idx, getNextIteration(idx));
  }
}
