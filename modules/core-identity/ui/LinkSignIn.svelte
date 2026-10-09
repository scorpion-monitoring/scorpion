<script lang="ts">
  import { onMount } from 'svelte';
  import { Alert, failureOf, getShell, ReauthCancelled } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { dropToken, stashedToken, stashToken, tokenFromFragment } from './fragment.ts';

  const { t, href, api, branding, session, goto, replaceUrl, withReauth, takeIntent } = getShell();

  type Phase =
    'checking' | 'ready' | 'working' | 'done' | 'invalid' | 'taken' | 'failed' | 'missing';
  let phase = $state<Phase>('checking');
  let providerName = $state('');
  let token: string | undefined;

  const storage = () => {
    try {
      return window.sessionStorage;
    } catch {
      return undefined;
    }
  };

  async function confirm() {
    if (!token) return;
    phase = 'working';
    try {
      const linked = await withReauth(
        () => unwrap(api.POST('/account/oidc-link/confirm', { body: { token: token! } })),
        { id: 'link.confirm' },
      );
      providerName = linked.name;
      dropToken(storage());
      token = undefined;
      phase = 'done';
    } catch (error) {
      if (error instanceof ReauthCancelled) {
        phase = 'ready';
        return;
      }
      const failure = failureOf(error);
      // The link is single use and lives a short time: whatever the answer, a second try cannot help,
      // except when only the network failed.
      if (failure.status === 0 || failure.status >= 500) {
        phase = 'failed';
        return;
      }
      dropToken(storage());
      token = undefined;
      phase = failure.status === 409 ? 'taken' : 'invalid';
    }
  }

  // The token comes from the address fragment, which the browser never sends to a server. It is read once
  // and the address replaced. A visitor who is not signed in goes to the sign-in page and comes back with
  // the token kept for the visit (session storage of this tab, removed when used).
  onMount(() => {
    token = tokenFromFragment(window.location.hash) ?? stashedToken(storage());
    replaceUrl(href('/link-sign-in'));
    if (!token) {
      phase = 'missing';
      return;
    }
    stashToken(storage(), token);
    if (!session()) {
      const back = encodeURIComponent(href('/link-sign-in'));
      void goto(href(`/login?returnTo=${back}`), { replace: true });
      return;
    }
    phase = 'ready';
    // Back from a sign-in at the provider that confirmed the identity: do what was asked.
    if (takeIntent('link.confirm')) void confirm();
  });
</script>

<svelte:head>
  <title>{t('link.title')} · {branding().instanceName}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-6">
  <h1 class="text-2xl font-bold">{t('link.title')}</h1>
  {#if phase === 'checking'}
    <p aria-live="polite">{t('link.checking')}</p>
  {:else if phase === 'ready' || phase === 'working'}
    <p>{t('link.lead')}</p>
    <button type="button" class="btn btn-primary" disabled={phase === 'working'} onclick={confirm}>
      {t('link.confirm')}
    </button>
  {:else if phase === 'done'}
    <Alert kind="success">{t('link.done', { name: providerName })}</Alert>
    <a class="btn btn-primary" href={href('/profile')}>{t('link.profile')}</a>
  {:else if phase === 'taken'}
    <Alert kind="error">{t('link.taken')}</Alert>
    <a class="btn btn-primary" href={href('/profile')}>{t('link.profile')}</a>
  {:else if phase === 'invalid' || phase === 'missing'}
    <Alert kind="error">{t('link.invalid')}</Alert>
    <a class="btn btn-primary" href={href('/profile')}>{t('link.profile')}</a>
  {:else}
    <Alert kind="error">{t('link.failed')}</Alert>
    <button type="button" class="btn btn-primary" onclick={confirm}>{t('link.retry')}</button>
  {/if}
</div>
