// What the notification status page needs before it renders. It runs on the server, after the permission
// check, and **throws** when it cannot get its data (defect 12). The delivery list needs a permission of
// its own: a caller who may see the counts but not the list gets the counts and no list.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import { storedOf, type Category, type Stored } from './prefs.ts';
import { deliveriesApiQuery, parseDeliveriesQuery, type DeliveriesQuery } from './query.ts';

export const PREFERENCES_KEY = 'notifications.preferences';

export interface NotificationStatus {
  emailTransport: 'smtp' | 'none';
  transportIsNone: boolean;
  webhookEnabled: boolean;
  counts: { queued: number; sending: number; sent: number; dead: number };
  sentWithoutTransport: number;
  lastErrors: { code: string; count: number; lastAt: string }[];
}

export interface Delivery {
  id: string;
  template: string;
  channel: 'email' | 'webhook';
  status: 'queued' | 'sending' | 'sent' | 'dead';
  attempts: number;
  lastError: string | null;
  transport: string | null;
  sensitive: boolean;
  recipientUserId: string | null;
  bodyAvailable: boolean;
  createdAt: string;
  statusChangedAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
}

export interface StatusData {
  status: NotificationStatus;
  query: DeliveriesQuery;
  /** `null` when the caller may not list deliveries (the page then shows the counts only). */
  deliveries: { rows: Delivery[]; total: number } | null;
}

export async function loadStatus({ api, url }: UiLoadContext): Promise<StatusData> {
  const query = parseDeliveriesQuery(url.searchParams);
  const [status, deliveries] = await Promise.all([
    unwrap(api.GET('/notifications/status')),
    unwrap(api.GET('/notifications/deliveries', { params: { query: deliveriesApiQuery(query) } }))
      .then((answer) => ({ rows: answer.result, total: answer.metadata.totalCount }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 403) return null;
        throw error;
      }),
  ]);
  return { status, query, deliveries };
}

export interface InboxItem {
  id: string;
  template: string;
  title: string;
  text: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface InboxData {
  items: InboxItem[];
  total: number;
  /** Unread items over all pages, from the count route. */
  unread: number;
  page: number;
  pageSize: number;
}

const whole = (value: string | null) =>
  value !== null && /^\d{1,7}$/.test(value) ? Number(value) : undefined;

export async function loadInbox({ api, url }: UiLoadContext): Promise<InboxData> {
  const page = whole(url.searchParams.get('page')) ?? 0;
  const asked = whole(url.searchParams.get('pageSize'));
  const pageSize = asked !== undefined && [10, 20, 50, 100].includes(asked) ? asked : 20;
  const [list, count] = await Promise.all([
    unwrap(
      api.GET('/notifications/inbox', {
        params: { query: { page: String(page), pageSize: String(pageSize) } },
      }),
    ),
    unwrap(api.GET('/notifications/inbox/unread-count')),
  ]);
  return {
    items: list.result,
    total: list.metadata.totalCount,
    unread: count.count,
    page,
    pageSize,
  };
}

export interface PreferencesData {
  categories: Category[];
  /** What is stored now (`{}` when nothing is). */
  stored: Stored;
}

export async function loadPreferences({ api }: UiLoadContext): Promise<PreferencesData> {
  const [categories, preferences] = await Promise.all([
    unwrap(
      api.GET('/notifications/preferences/categories', { params: { query: { pageSize: '100' } } }),
    ),
    // The preference routes need their own permission; without it the form starts from "everything on".
    unwrap(api.GET('/preferences', { params: { query: { pageSize: '100' } } })).catch(
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 403) return undefined;
        throw error;
      },
    ),
  ]);
  const found = preferences?.result.find((entry) => entry.key === PREFERENCES_KEY);
  return { categories: categories.result, stored: storedOf(found?.value) };
}
