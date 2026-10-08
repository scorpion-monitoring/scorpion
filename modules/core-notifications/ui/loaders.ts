// What the notification status page needs before it renders. It runs on the server, after the permission
// check, and **throws** when it cannot get its data (defect 12). The delivery list needs a permission of
// its own: a caller who may see the counts but not the list gets the counts and no list.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import { deliveriesApiQuery, parseDeliveriesQuery, type DeliveriesQuery } from './query.ts';

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
