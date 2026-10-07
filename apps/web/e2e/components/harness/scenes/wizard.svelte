<script lang="ts">
  import { TextField, Wizard } from '@scorpion/ui-kit';

  let name = $state('');
  let email = $state('');
  let done = $state('');
  const dirty = $derived(name !== '' || email !== '');
</script>

<h1 class="mb-4 text-2xl font-bold">Wizard</h1>
<Wizard
  steps={[
    { id: 'who', label: 'Who' },
    { id: 'contact', label: 'Contact' },
    { id: 'review', label: 'Review' },
  ]}
  {dirty}
  validate={(id) => {
    if (id === 'who' && name.trim() === '') return ['Enter a name.'];
    if (id === 'contact' && !email.includes('@')) return ['Enter an email address.'];
    return undefined;
  }}
  onfinish={() => {
    done = `${name} <${email}>`;
  }}
  finishLabel="Create"
>
  {#snippet step(id)}
    {#if id === 'who'}
      <TextField label="Name" autocomplete="off" bind:value={name} />
    {:else if id === 'contact'}
      <TextField label="Email" autocomplete="off" bind:value={email} />
    {:else}
      <p>
        Name: <span data-testid="review-name">{name}</span>, email:
        <span data-testid="review-email">{email}</span>
      </p>
    {/if}
  {/snippet}
</Wizard>
<p class="mt-4">Result: <span data-testid="done">{done}</span></p>
