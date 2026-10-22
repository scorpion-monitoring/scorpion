<script lang="ts">
  // The "Dashboard defaults" dialog (`DashboardDefaults`) over a stand-in for the API: the same two services and categories as the settings scene.
  // What the dialog stores (`PUT /preferences/{key}`) and whether it was told to close are shown for the specs.
  import {
    DashboardDefaults,
    getShell,
    setAnalyticsReads,
    setShell,
    type AnalyticsReads,
  } from '@scorpion/ui-kit';

  const services = [
    { id: '018f3b7e-aaaa-7000-8000-00000000000a', name: 'Alpha service', slug: 'alpha' },
    { id: '018f3b7e-bbbb-7000-8000-00000000000b', name: 'Beta service', slug: 'beta' },
  ];
  const stored = $state<string[]>([]);
  const ok = <T,>(data: T) => ({ data, response: new Response(null, { status: 200 }) });
  const shell = getShell();
  const api = {
    GET: (path: string, options?: { params?: { query?: { q?: string } } }) => {
      const q = options?.params?.query?.q;
      return Promise.resolve(
        ok({
          metadata: { currentPage: 0, pageSize: 50, totalCount: 2, totalPages: 1 },
          result: services.filter((service) => !q || service.slug.includes(q)),
        }),
      );
    },
    PUT: (path: string, options: { params: { path: { key: string } }; body: unknown }) => {
      stored.push(`${options.params.path.key} ${JSON.stringify(options.body)}`);
      return Promise.resolve(ok({}));
    },
  };
  setShell({ ...shell, api: api as never });
  const reads: AnalyticsReads = {
    service: (id) => Promise.resolve(services.find((service) => service.id === id)!),
    defaults: () =>
      Promise.resolve({
        service: null,
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
  let open = $state(true);
</script>

<h1 class="mb-4 text-2xl font-bold">Dashboard defaults</h1>
<button type="button" class="btn" onclick={() => (open = true)}>Open the defaults</button>
{#if open}
  <DashboardDefaults ranges={['3m', '6m', '1y', '2y', 'all']} onclose={() => (open = false)} />
{/if}
<p data-testid="stored">{stored.join(' | ')}</p>
<p data-testid="state">{open ? 'open' : 'closed'}</p>
