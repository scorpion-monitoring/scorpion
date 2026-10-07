// The queue of toasts, without any framework: pages push a message, the `Toasts` component shows it and
// removes it again. A success or an information fades after a few seconds; an error stays until the person
// closes it, because a message that vanishes is a message a slow reader never gets (WCAG 2.2.1).
export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ToasterOptions {
  /** How long an information or a success stays, in milliseconds. */
  durationMs?: number;
  /** The most toasts shown at once; the oldest goes when a new one arrives. */
  max?: number;
  setTimer?: (action: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface Toaster {
  push(kind: ToastKind, text: string): number;
  info(text: string): number;
  success(text: string): number;
  error(text: string): number;
  dismiss(id: number): void;
  toasts(): readonly Toast[];
  /** Calls `listener` now and after every change; returns the function that stops it. */
  subscribe(listener: (toasts: readonly Toast[]) => void): () => void;
}

export function createToaster(options: ToasterOptions = {}): Toaster {
  const { durationMs = 6000, max = 4 } = options;
  const setTimer = options.setTimer ?? ((action, ms) => setTimeout(action, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as number));
  let list: Toast[] = [];
  let nextId = 1;
  const timers = new Map<number, unknown>();
  const listeners = new Set<(toasts: readonly Toast[]) => void>();
  const emit = () => {
    for (const listener of listeners) listener(list);
  };

  function dismiss(id: number) {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimer(timer);
    timers.delete(id);
    if (!list.some((toast) => toast.id === id)) return;
    list = list.filter((toast) => toast.id !== id);
    emit();
  }

  function push(kind: ToastKind, text: string): number {
    const id = nextId++;
    list = [...list, { id, kind, text }];
    while (list.length > max) dismiss(list[0]!.id);
    if (kind !== 'error')
      timers.set(
        id,
        setTimer(() => dismiss(id), durationMs),
      );
    emit();
    return id;
  }

  return {
    push,
    info: (text) => push('info', text),
    success: (text) => push('success', text),
    error: (text) => push('error', text),
    dismiss,
    toasts: () => list,
    subscribe(listener) {
      listeners.add(listener);
      listener(list);
      return () => void listeners.delete(listener);
    },
  };
}
