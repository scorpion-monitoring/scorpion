<script lang="ts">
  // A labelled text input with its hint and the messages the server gave for it. The label, the hint and
  // the messages are tied to the input (`for`, `aria-describedby`, `aria-invalid`), so a screen reader
  // reads them with it. Never `autocomplete="off"` on a password field: password managers and paste
  // must work (ASVS 6.2.6, 6.2.7), so pass `autocomplete` as the browser names it.
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    label,
    value = $bindable(''),
    errors = [],
    hint,
    type = 'text',
    autocomplete,
    ...rest
  }: {
    label: string;
    value?: string;
    errors?: readonly string[];
    hint?: string;
    type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'date';
    autocomplete: HTMLInputAttributes['autocomplete'];
  } & Omit<HTMLInputAttributes, 'value' | 'type' | 'autocomplete' | 'class' | 'id'> = $props();

  const id = $props.id();
  const describedBy = $derived(
    [hint ? `${id}-hint` : '', errors.length > 0 ? `${id}-error` : ''].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="flex flex-col gap-1">
  <label class="text-sm font-medium" for={id}>{label}</label>
  <input
    {id}
    {type}
    {autocomplete}
    class="input input-bordered w-full"
    class:input-error={errors.length > 0}
    aria-invalid={errors.length > 0 ? 'true' : undefined}
    aria-describedby={describedBy}
    bind:value
    {...rest}
  />
  {#if hint}<p id="{id}-hint" class="text-sm opacity-70">{hint}</p>{/if}
  {#if errors.length > 0}
    <p id="{id}-error" class="text-error text-sm">{errors.join(' ')}</p>
  {/if}
</div>
