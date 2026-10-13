<script lang="ts">
  // The JSON console of the wizard: the form's body as text, edited in both directions (what is typed in a field
  // shows here, what is typed here shows in the fields). It exists only when the server says it is not running
  // in production (`devConsole` of `GET /services/schema`); the page does not draw this component otherwise, so
  // a production page has no console in its DOM. An edit is checked exactly like an edit of a field.
  import { getShell } from '@scorpion/ui-kit';

  let {
    text,
    problems,
    onedit,
  }: {
    text: string;
    /** What is wrong with the text (not JSON, not an object) or with what it says, as lines. */
    problems: readonly string[];
    onedit: (text: string) => void;
  } = $props();
  const { t } = getShell();
  const id = $props.id();
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="{id}-title">
  <div class="card-body gap-3">
    <h2 id="{id}-title" class="card-title">{t('services.console.title')}</h2>
    <p class="text-sm opacity-70">{t('services.console.help')}</p>
    <div class="flex flex-col gap-1">
      <label class="text-sm font-medium" for="{id}-text">{t('services.console.label')}</label>
      <textarea
        id="{id}-text"
        class="textarea textarea-bordered h-96 w-full font-mono text-sm"
        spellcheck="false"
        autocomplete="off"
        aria-describedby={problems.length > 0 ? `${id}-problems` : undefined}
        aria-invalid={problems.length > 0 ? 'true' : undefined}
        value={text}
        oninput={(event) => onedit(event.currentTarget.value)}></textarea>
    </div>
    {#if problems.length > 0}
      <ul id="{id}-problems" class="text-error list-disc ps-5 text-sm">
        {#each problems as problem (problem)}<li>{problem}</li>{/each}
      </ul>
    {/if}
  </div>
</section>
