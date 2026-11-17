<script lang="ts">
  // The theme colours of the branding form (M12a sprint 4): the light and the dark theme as two tabs of one control, so the screen
  // holds one theme's twenty colours at a time. A tab's label says how many pairs of that theme would be refused (the same check the
  // server runs), so a problem in the hidden theme is seen; after a refused save the tab of the theme the server named is opened (its
  // messages are in the form's summary at the top).
  import { untrack } from 'svelte';
  import { getShell, Tabs, type WidgetProps } from '@scorpion/ui-kit';
  import { contrastFailures, THEME_MODES, type ThemeMode } from '@scorpion/contracts/theme-colors';
  import ThemeColorsPanel from './ThemeColorsPanel.svelte';

  let { node, value, onchange, errors, errorsBelow, disabled }: WidgetProps = $props();
  const { t } = getShell();

  const record = $derived((value ?? {}) as Record<string, unknown>);
  const childOf = (mode: ThemeMode) => node.children.find((child) => child.key === mode);
  /** The server's messages for a theme (the pair check names the theme's path; a value's format, its token's). */
  const messagesOf = (mode: ThemeMode) =>
    [...(errorsBelow ?? new Map<string, readonly string[]>())]
      .filter(([pointer]) => pointer === `/${mode}` || pointer.startsWith(`/${mode}/`))
      .flatMap(([, messages]) => messages);
  /** The pairs of a theme that would be refused now (the same check as the server's), so the count follows every edit. */
  const problems = (mode: ThemeMode) => contrastFailures(mode, record[mode]).length;

  const tabs = $derived(
    THEME_MODES.filter((mode) => childOf(mode) !== undefined).map((mode) => {
      const count = problems(mode);
      const theme = t(`admin.colors.tab.${mode}`);
      return {
        id: mode,
        label: count === 0 ? theme : t('admin.colors.tabProblems', { theme, count }),
      };
    }),
  );

  let selected = $state<string>('light');
  // A refused save opens the theme the server named, unless the open one has a message too. It reacts to new messages only, so the
  // person can still open the other tab while they stand.
  $effect(() => {
    const named = THEME_MODES.filter((mode) => messagesOf(mode).length > 0);
    untrack(() => {
      if (named.length > 0 && !named.includes(selected as ThemeMode)) selected = named[0]!;
    });
  });
</script>

{#if errors.length > 0}
  <ul class="text-error list-disc ps-5 text-sm">
    {#each errors as message (message)}<li>{message}</li>{/each}
  </ul>
{/if}
<Tabs {tabs} bind:selected label={t('admin.colors.tabs')}>
  {#snippet children(id: string)}
    {@const mode = id as ThemeMode}
    {@const child = childOf(mode)}
    {#if child}
      <ThemeColorsPanel
        node={child}
        value={record[mode]}
        {disabled}
        onchange={(next: unknown) => onchange({ ...record, [mode]: next })}
      />
    {/if}
  {/snippet}
</Tabs>
