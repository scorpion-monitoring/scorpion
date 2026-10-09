<script lang="ts">
  import { getShell } from '@scorpion/ui-kit';
  import type { ProfileData } from './loaders.ts';
  import Avatar from './profile/Avatar.svelte';
  import Details from './profile/Details.svelte';
  import Password from './profile/Password.svelte';
  import Preferences from './profile/Preferences.svelte';
  import Providers from './profile/Providers.svelte';
  import Sessions from './profile/Sessions.svelte';
  import Tokens from './profile/Tokens.svelte';

  let { data }: { data: ProfileData } = $props();
  const { t, branding } = getShell();
</script>

<svelte:head>
  <title>{t('profile.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <h1 class="text-2xl font-bold">{t('profile.title')}</h1>
  <Details profile={data.profile} />
  <Avatar profile={data.profile} />
  <Preferences locale={data.locale} />
  <Password />
  <Providers providers={data.providers} />
  {#if data.tokens}<Tokens tokens={data.tokens} permissions={data.permissions ?? []} />{/if}
  {#if data.sessions}<Sessions sessions={data.sessions} />{/if}
</div>
