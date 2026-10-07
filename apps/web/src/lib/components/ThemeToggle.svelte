<script lang="ts">
  import { onMount } from 'svelte';
  import { getShell } from '@scorpion/ui-kit';
  import { applyTheme, readTheme, storeTheme, type ThemeChoice } from '#lib/theme.ts';
  import Icon from './Icon.svelte';

  const { t } = getShell();
  let choice = $state<ThemeChoice>('system');

  // The page starts with "system" on the server; the stored choice is read when it reaches the browser.
  onMount(() => {
    choice = readTheme(window.localStorage);
  });

  function pick(next: ThemeChoice) {
    choice = next;
    applyTheme(document.documentElement, next);
    storeTheme(window.localStorage, next);
  }

  const options: { value: ThemeChoice; icon: string; label: string }[] = [
    { value: 'system', icon: 'desktop', label: 'app.theme.system' },
    { value: 'light', icon: 'sun', label: 'app.theme.light' },
    { value: 'dark', icon: 'moon', label: 'app.theme.dark' },
  ];
</script>

<div class="join" role="group" aria-label={t('app.theme.label')}>
  {#each options as option (option.value)}
    <button
      type="button"
      class="btn btn-sm join-item {choice === option.value ? 'btn-active' : ''}"
      aria-pressed={choice === option.value}
      aria-label={t(option.label)}
      title={t(option.label)}
      onclick={() => pick(option.value)}
    >
      <Icon name={option.icon} size={16} />
    </button>
  {/each}
</div>
