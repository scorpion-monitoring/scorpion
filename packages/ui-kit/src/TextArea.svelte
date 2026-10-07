<script lang="ts">
  // A labelled multi-line input, tied to its hint and messages like `TextField`.
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  let {
    label,
    value = $bindable(''),
    errors = [],
    hint,
    ...rest
  }: {
    label: string;
    value?: string;
    errors?: readonly string[];
    hint?: string;
  } & Omit<HTMLTextareaAttributes, 'value' | 'class' | 'id'> = $props();

  const id = $props.id();
  const describedBy = $derived(
    [hint ? `${id}-hint` : '', errors.length > 0 ? `${id}-error` : ''].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="flex flex-col gap-1">
  <label class="text-sm font-medium" for={id}>{label}</label>
  <textarea
    {id}
    class="textarea textarea-bordered w-full"
    class:textarea-error={errors.length > 0}
    aria-invalid={errors.length > 0 ? 'true' : undefined}
    aria-describedby={describedBy}
    bind:value
    {...rest}></textarea>
  {#if hint}<p id="{id}-hint" class="text-sm opacity-70">{hint}</p>{/if}
  {#if errors.length > 0}
    <p id="{id}-error" class="text-error text-sm">{errors.join(' ')}</p>
  {/if}
</div>
