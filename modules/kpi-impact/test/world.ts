// Helpers of the impact tests: unique names (specs share a database), the error a promise rejects with, a consortium with services.
import { DomainError } from '@scorpion/contracts';

let counter = 0;
export const uniq = (prefix: string) =>
  `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

/** The error a promise rejects with; the test fails when it resolved. */
export async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

/** The `in:path` of every problem of a 422, sorted. */
export const paths = (error: DomainError) =>
  (error.errors ?? []).map((e) => `${e.in}:${e.path}`).sort();
