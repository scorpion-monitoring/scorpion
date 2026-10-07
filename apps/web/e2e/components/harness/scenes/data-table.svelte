<script lang="ts">
  import { DataTable, nextSort, type Column, type Sort } from '@scorpion/ui-kit';

  interface Person {
    id: string;
    name: string;
    group: string;
    age: number | null;
  }
  const everyone: Person[] = Array.from({ length: 45 }, (_, n) => ({
    id: `p${String(n).padStart(2, '0')}`,
    name: `Person ${String(45 - n).padStart(2, '0')}`,
    group: ['red', 'green', 'blue'][n % 3]!,
    age: n % 7 === 0 ? null : 20 + (n % 5),
  }));

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('state'); // loading | error | empty

  // The "server": sorts by the column, then by id, and cuts the page.
  let sort = $state<Sort>({ key: 'name', direction: 'asc' });
  let page = $state(0);
  let pageSize = $state(10);
  const sorted = $derived(
    [...everyone].sort((a, b) => {
      const x = a[sort.key as 'name' | 'group' | 'age'];
      const y = b[sort.key as 'name' | 'group' | 'age'];
      const order = x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
      return order * (sort.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
    }),
  );
  const rows = $derived(
    mode === 'empty' ? [] : sorted.slice(page * pageSize, (page + 1) * pageSize),
  );
  let removed = $state('');

  const columns: Column<Person>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      rowHeader: true,
      value: (row: Person) => row.name,
    },
    { key: 'group', header: 'Group', sortable: true, value: (row) => row.group },
    { key: 'age', header: 'Age', sortable: true, value: (row: Person) => row.age ?? '' },
  ];

  // A short list that sorts itself.
  const small: Person[] = everyone.slice(0, 5);
  void nextSort;
</script>

<h1 class="mb-4 text-2xl font-bold">Data table</h1>

<section aria-labelledby="server-title" class="mb-10">
  <h2 id="server-title" class="mb-2 text-xl font-semibold">Server-side</h2>
  <DataTable
    {columns}
    {rows}
    rowKey={(row: Person) => row.id}
    caption="People"
    {sort}
    onsort={(next: Sort) => {
      sort = next;
      page = 0;
    }}
    {page}
    {pageSize}
    total={mode === 'empty' ? 0 : everyone.length}
    pageSizes={[10, 20]}
    onpage={(next: number) => (page = next)}
    onpagesize={(next: number) => {
      pageSize = next;
      page = 0;
    }}
    loading={mode === 'loading'}
    error={mode === 'error' ? 'The list could not be loaded.' : undefined}
    onretry={() => (window.location.search = '')}
    empty="Nobody here."
    actionsLabel="Actions"
  >
    {#snippet actions(row: Person)}
      <button type="button" class="btn btn-ghost btn-xs" aria-label={`Open ${row.name}`}
        >Open</button
      >
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-label={`Remove ${row.name}`}
        onclick={() => (removed = row.id)}
      >
        Remove
      </button>
    {/snippet}
  </DataTable>
  <p>Removed: <span data-testid="removed">{removed}</span></p>
</section>

<section aria-labelledby="local-title">
  <h2 id="local-title" class="mb-2 text-xl font-semibold">Sorts itself</h2>
  <DataTable
    columns={[
      {
        key: 'name',
        header: 'Name',
        sortable: true,
        rowHeader: true,
        value: (row: Person) => row.name,
      },
      { key: 'age', header: 'Age', sortable: true, value: (row: Person) => row.age },
    ]}
    rows={small}
    rowKey={(row: Person) => row.id}
    caption="A short list"
  />
</section>
