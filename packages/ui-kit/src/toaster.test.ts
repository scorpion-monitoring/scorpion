import { describe, expect, it } from 'vitest';
import { createToaster } from './toaster.ts';

function clock() {
  const pending = new Map<number, { action: () => void; at: number }>();
  let now = 0;
  let next = 1;
  return {
    setTimer: (action: () => void, ms: number) => {
      pending.set(next, { action, at: now + ms });
      return next++;
    },
    clearTimer: (timer: unknown) => void pending.delete(timer as number),
    advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...pending]) {
        if (entry.at <= now) {
          pending.delete(id);
          entry.action();
        }
      }
    },
    pending: () => pending.size,
  };
}

describe('createToaster', () => {
  it('shows a toast and tells every listener', () => {
    const toaster = createToaster();
    const seen: string[][] = [];
    const stop = toaster.subscribe((toasts) => seen.push(toasts.map((toast) => toast.text)));
    toaster.success('Saved');
    toaster.info('Note');
    stop();
    toaster.error('after the end');
    expect(seen).toEqual([[], ['Saved'], ['Saved', 'Note']]);
  });

  it('removes an information and a success after the duration, and an error never', () => {
    const time = clock();
    const toaster = createToaster({ durationMs: 1000, ...time });
    toaster.success('a');
    toaster.info('b');
    toaster.error('c');
    time.advance(999);
    expect(toaster.toasts().map((toast) => toast.text)).toEqual(['a', 'b', 'c']);
    time.advance(1);
    expect(toaster.toasts().map((toast) => toast.text)).toEqual(['c']);
    time.advance(1_000_000);
    expect(toaster.toasts().map((toast) => toast.kind)).toEqual(['error']);
  });

  it('keeps the newest few: a new toast pushes the oldest out, and its timer with it', () => {
    const time = clock();
    const toaster = createToaster({ max: 2, ...time });
    toaster.success('1');
    toaster.success('2');
    toaster.success('3');
    expect(toaster.toasts().map((toast) => toast.text)).toEqual(['2', '3']);
    expect(time.pending()).toBe(2);
  });

  it('dismisses one by id, once, and ignores an id that is gone', () => {
    const time = clock();
    const toaster = createToaster(time);
    const id = toaster.success('a');
    const calls: number[] = [];
    toaster.subscribe((toasts) => calls.push(toasts.length));
    toaster.dismiss(id);
    toaster.dismiss(id);
    toaster.dismiss(999);
    expect(calls).toEqual([1, 0]);
    expect(time.pending()).toBe(0);
  });

  it('gives every toast its own id', () => {
    const toaster = createToaster();
    expect(new Set([toaster.info('a'), toaster.info('b'), toaster.info('c')]).size).toBe(3);
  });
});
