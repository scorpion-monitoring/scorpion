// What the address of the notification status page says: the filters and the page of the delivery list.
// A value that is not valid is dropped, so a bookmarked or edited address never breaks the page.
export const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'dead'] as const;
export const DELIVERY_CHANNELS = ['email', 'webhook'] as const;
export const DELIVERY_PAGE_SIZES = [10, 20, 50] as const;

export interface DeliveriesQuery {
  page: number;
  pageSize: number;
  status: (typeof DELIVERY_STATUSES)[number] | undefined;
  channel: (typeof DELIVERY_CHANNELS)[number] | undefined;
  template: string | undefined;
}

export const DEFAULT_DELIVERIES_QUERY: DeliveriesQuery = {
  page: 0,
  pageSize: 20,
  status: undefined,
  channel: undefined,
  template: undefined,
};

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  list.find((entry) => entry === value);

const whole = (value: string | null): number | undefined =>
  value !== null && /^\d{1,7}$/.test(value) ? Number(value) : undefined;

export function parseDeliveriesQuery(params: URLSearchParams): DeliveriesQuery {
  const pageSize = whole(params.get('pageSize'));
  const template = params.get('template')?.trim();
  return {
    page: whole(params.get('page')) ?? 0,
    pageSize:
      pageSize !== undefined && (DELIVERY_PAGE_SIZES as readonly number[]).includes(pageSize)
        ? pageSize
        : DEFAULT_DELIVERIES_QUERY.pageSize,
    status: oneOf(DELIVERY_STATUSES, params.get('status')),
    channel: oneOf(DELIVERY_CHANNELS, params.get('channel')),
    template: template ? template.slice(0, 100) : undefined,
  };
}

export function deliveriesQueryString(query: DeliveriesQuery): string {
  const params = new URLSearchParams();
  if (query.page > 0) params.set('page', String(query.page));
  if (query.pageSize !== DEFAULT_DELIVERIES_QUERY.pageSize)
    params.set('pageSize', String(query.pageSize));
  if (query.status) params.set('status', query.status);
  if (query.channel) params.set('channel', query.channel);
  if (query.template) params.set('template', query.template);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function deliveriesApiQuery(query: DeliveriesQuery): Record<string, string> {
  return {
    page: String(query.page),
    pageSize: String(query.pageSize),
    ...(query.status ? { status: query.status } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.template ? { template: query.template } : {}),
  };
}

/** Any change other than the page itself starts again at the first page. */
export function changeDeliveriesQuery(
  current: DeliveriesQuery,
  change: Partial<DeliveriesQuery>,
): DeliveriesQuery {
  const next = { ...current, ...change };
  return Object.keys(change).every((key) => key === 'page')
    ? next
    : { ...next, page: change.page ?? 0 };
}
