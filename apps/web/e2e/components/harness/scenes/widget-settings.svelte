<script lang="ts">
  // The settings form of a dashboard widget (`WidgetSettings`) over a stand-in for the API: two services, the categories of the defaults
  // route and a store that answers from memory. The JSON Schema is what `z.toJSONSchema` writes for the trends widget. `?bad` opens it on a
  // configuration that breaks the schema. What "Apply" gives the widget is shown as JSON, and so is every request the form made.

  import {
    getShell,
    setAnalyticsReads,
    setShell,
    WidgetSettings,
    type AnalyticsReads,
  } from '@scorpion/ui-kit';

  const services = [
    { id: '018f3b7e-aaaa-7000-8000-00000000000a', name: 'Alpha service', slug: 'alpha' },
    { id: '018f3b7e-bbbb-7000-8000-00000000000b', name: 'Beta service', slug: 'beta' },
  ];
  const requests = $state<string[]>([]);
  const ok = <T,>(data: T) => ({ data, response: new Response(null, { status: 200 }) });
  const shell = getShell();
  const api = {
    GET: (path: string, options?: { params?: { query?: { q?: string } } }) => {
      const q = options?.params?.query?.q;
      requests.push(`GET ${path}${q ? `?q=${q}` : ''}`);
      return Promise.resolve(
        ok({
          metadata: { currentPage: 0, pageSize: 50, totalCount: services.length, totalPages: 1 },
          result: services.filter((service) => !q || service.slug.includes(q)),
        }),
      );
    },
    PUT: () => Promise.resolve(ok({})),
  };
  setShell({ ...shell, api: api as never });
  const reads: AnalyticsReads = {
    service: (id) => Promise.resolve(services.find((service) => service.id === id)!),
    defaults: () =>
      Promise.resolve({
        service: services[0]!.id,
        range: '1y',
        category: 'all',
        categories: [
          { key: 'Usage', label: 'Usage' },
          { key: 'Technical', label: 'Technical' },
        ],
      }),
    summary: () => Promise.reject(new Error('not used')),
    series: () => Promise.reject(new Error('not used')),
    terms: () => Promise.resolve([]),
    invalidate: () => undefined,
  };
  setAnalyticsReads(reads);

  const schema = {
    type: 'object',
    properties: {
      service: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
      range: { type: 'string', enum: ['3m', '6m', '1y', '2y', 'all'], default: '1y' },
      category: { type: 'string', minLength: 1, maxLength: 32, default: 'all' },
      hidden: { type: 'array', maxItems: 14, items: { type: 'string', pattern: '^[0-9a-f]{12}$' } },
      cumulative: { type: 'array', maxItems: 14, items: { type: 'string' } },
    },
  };
  const bad = new URLSearchParams(window.location.search).has('bad');
  const config = {
    service: null,
    range: '1y',
    category: bad ? 'x'.repeat(40) : 'all',
    hidden: ['0123456789ab'],
  };
  let applied = $state<string>('');
  let closed = $state(false);
</script>

<h1 class="mb-4 text-2xl font-bold">Widget settings</h1>
<WidgetSettings
  {schema}
  {config}
  onapply={(next) => (applied = JSON.stringify(next))}
  onclose={() => (closed = true)}
/>
<p data-testid="applied">{applied}</p>
<p data-testid="closed">{closed ? 'closed' : 'open'}</p>
<p data-testid="requests">{requests.join(' | ')}</p>
