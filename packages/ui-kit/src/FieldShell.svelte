<script lang="ts">
  // The frame of one form field: a label, a hint and the server's messages, tied to the control with `for`,
  // `aria-describedby` and `aria-invalid` so a screen reader reads them with it. The control is drawn by the
  // caller and gets the ids it needs.
  import type { Snippet } from 'svelte';

  interface ControlProps {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }

  let {
    label,
    hint,
    errors = [],
    required = false,
    requiredText,
    children,
  }: {
    label: string;
    hint?: string;
    errors?: readonly string[];
    required?: boolean;
    /** The word that marks a required field, already translated. */
    requiredText?: string;
    children: Snippet<[ControlProps]>;
  } = $props();

  const id = $props.id();
  const describedBy = $derived(
    [hint ? `${id}-hint` : '', errors.length > 0 ? `${id}-error` : ''].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="flex flex-col gap-1">
  <label class="text-sm font-medium" for={id}>
    {label}{#if required && requiredText}<span class="opacity-70"> ({requiredText})</span>{/if}
  </label>
  {@render children({ id, describedBy, invalid: errors.length > 0 })}
  {#if hint}<p id="{id}-hint" class="text-sm opacity-70">{hint}</p>{/if}
  {#if errors.length > 0}
    <p id="{id}-error" class="text-error text-sm">{errors.join(' ')}</p>
  {/if}
</div>
