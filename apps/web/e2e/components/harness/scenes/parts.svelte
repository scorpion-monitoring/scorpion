<script lang="ts">
  import { Breadcrumb, ConfirmDialog, getShell, Pagination, Tabs } from '@scorpion/ui-kit';

  const { toaster } = getShell();
  let confirming = $state(false);
  let confirmed = $state('');
  let tab = $state('one');
  let page = $state(2);
  let pageSize = $state(20);
</script>

<h1 class="mb-4 text-2xl font-bold">Small parts</h1>

<section class="mb-8" aria-labelledby="toast-title">
  <h2 id="toast-title" class="mb-2 text-xl font-semibold">Toasts</h2>
  <div class="flex gap-2">
    <button type="button" class="btn btn-sm" onclick={() => toaster.success('Saved.')}
      >Success</button
    >
    <button type="button" class="btn btn-sm" onclick={() => toaster.info('Heads up.')}>Info</button>
    <button type="button" class="btn btn-sm" onclick={() => toaster.error('That failed.')}
      >Error</button
    >
  </div>
</section>

<section class="mb-8" aria-labelledby="confirm-title">
  <h2 id="confirm-title" class="mb-2 text-xl font-semibold">Confirm dialog</h2>
  <button type="button" class="btn btn-sm" onclick={() => (confirming = true)}
    >End every session</button
  >
  <p>Confirmed: <span data-testid="confirmed">{confirmed}</span></p>
  <ConfirmDialog
    open={confirming}
    title="End every session?"
    message="Everybody except you has to sign in again."
    confirmLabel="End them"
    onconfirm={() => {
      confirming = false;
      confirmed = 'yes';
    }}
    oncancel={() => {
      confirming = false;
      confirmed = confirmed || 'no';
    }}
  />
</section>

<section class="mb-8" aria-labelledby="tabs-title">
  <h2 id="tabs-title" class="mb-2 text-xl font-semibold">Tabs</h2>
  <Tabs
    label="Sections"
    bind:selected={tab}
    tabs={[
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
      { id: 'three', label: 'Three' },
    ]}
  >
    {#snippet children(id: string)}
      <p>Panel {id}</p>
    {/snippet}
  </Tabs>
</section>

<section class="mb-8" aria-labelledby="crumb-title">
  <h2 id="crumb-title" class="mb-2 text-xl font-semibold">Breadcrumb</h2>
  <Breadcrumb
    items={[{ label: 'Home', href: '/' }, { label: 'Admin', href: '/admin' }, { label: 'Users' }]}
  />
</section>

<section aria-labelledby="page-title">
  <h2 id="page-title" class="mb-2 text-xl font-semibold">Pagination</h2>
  <Pagination
    {page}
    {pageSize}
    total={134}
    onpage={(next: number) => (page = next)}
    onpagesize={(next: number) => {
      pageSize = next;
      page = 0;
    }}
  />
  <p>Page: <span data-testid="page">{page}</span></p>
</section>
