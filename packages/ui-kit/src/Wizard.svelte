<script lang="ts">
  // A form in steps. The progress list shows where the person is and lets them go back to a step they have
  // reached; "Next" validates the step they are on and only then moves on. The wizard keeps no form state:
  // the page owns it, so everything typed stays when a step is left and opened again. While the page says it
  // is `dirty`, leaving it (a reload, a closed tab, a link) asks first.
  import { onMount, type Snippet } from 'svelte';
  import Alert from './Alert.svelte';
  import { getShell } from './context.ts';
  import type { WizardStep } from './kit-types.ts';
  import { createWizard, type StepProblems, type Wizard } from './wizard.ts';

  let {
    steps,
    step,
    validate,
    onfinish,
    dirty = false,
    busy = false,
    finishLabel,
  }: {
    steps: readonly WizardStep[];
    /** The content of one step. Only the current step is drawn. */
    step: Snippet<[string]>;
    /** The problems of a step; none means it may be left. */
    validate?: (stepId: string) => StepProblems | Promise<StepProblems>;
    onfinish: () => void | Promise<void>;
    dirty?: boolean;
    busy?: boolean;
    finishLabel?: string;
  } = $props();
  const { t, guardLeave } = getShell();

  // The steps are fixed for the life of the wizard.
  // svelte-ignore state_referenced_locally
  const machine: Wizard = createWizard({
    steps: steps.map((entry) => entry.id),
    validate: (id) => validate?.(id),
  });
  let view = $state(machine.state());
  let heading = $state<HTMLElement>();
  const headingId = $props.id();
  const refresh = () => (view = machine.state());

  async function move(action: () => Promise<boolean> | boolean | void) {
    const before = machine.state().index;
    await action();
    refresh();
    if (view.finished) {
      await onfinish();
      return;
    }
    if (view.index !== before) heading?.focus();
  }

  onMount(() => guardLeave(() => dirty && !view.finished));

  const last = $derived(view.index === steps.length - 1);
</script>

<div class="flex flex-col gap-6">
  <nav aria-label={t('kit.wizard.progress')}>
    <ol class="steps w-full">
      {#each steps as entry, index (entry.id)}
        <li
          class="step"
          class:step-primary={index <= view.reached}
          aria-current={index === view.index ? 'step' : undefined}
        >
          {#if index <= view.reached && index !== view.index}
            <button type="button" class="link" onclick={() => move(() => machine.goTo(index))}>
              {entry.label}
            </button>
          {:else}
            {entry.label}
          {/if}
        </li>
      {/each}
    </ol>
  </nav>

  <section aria-labelledby={headingId} class="flex flex-col gap-4">
    <h2 id={headingId} tabindex="-1" class="text-xl font-semibold" bind:this={heading}>
      {t('kit.wizard.step', {
        current: view.index + 1,
        total: steps.length,
        label: steps[view.index]?.label ?? '',
      })}
    </h2>
    {#if view.problems.length > 0}
      <Alert kind="error">
        <ul class="list-disc ps-4">
          {#each view.problems as problem (problem)}<li>{problem}</li>{/each}
        </ul>
      </Alert>
    {/if}
    {@render step(steps[view.index]!.id)}
  </section>

  <div class="flex justify-between gap-2">
    <button
      type="button"
      class="btn"
      disabled={view.index === 0 || busy}
      onclick={() => move(() => machine.back())}
    >
      {t('kit.wizard.back')}
    </button>
    <button
      type="button"
      class="btn btn-primary"
      disabled={busy}
      onclick={() => move(() => machine.next())}
    >
      {last ? (finishLabel ?? t('kit.wizard.finish')) : t('kit.wizard.next')}
    </button>
  </div>
</div>
