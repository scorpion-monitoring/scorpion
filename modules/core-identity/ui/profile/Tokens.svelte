<script lang="ts">
  import {
    Alert,
    failureOf,
    getShell,
    SubmitButton,
    TextField,
    Time,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import type { ProfileData } from '../loaders.ts';

  let {
    tokens,
    permissions,
  }: {
    tokens: NonNullable<ProfileData['tokens']>;
    permissions: NonNullable<ProfileData['permissions']>;
  } = $props();
  const { t, api, refresh } = getShell();

  let name = $state('');
  let scopes = $state<string[]>([]);
  let expires = $state('');
  let busy = $state(false);
  let failure = $state<FormFailure>();
  /** The secret of the token that was just made or replaced. It exists here only, and only until it is dismissed. */
  let shown = $state<{ name: string; secret: string }>();
  let copied = $state<'yes' | 'no'>();
  let asking = $state<string>();

  /** The end of the chosen day, as the instant the API wants. */
  const expiresAt = (day: string) => (day ? `${day}T23:59:59Z` : null);

  async function create(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failure = undefined;
    try {
      const made = await unwrap(
        api.POST('/tokens', { body: { name, scopes, expiresAt: expiresAt(expires) } }),
      );
      shown = { name: made.name, secret: made.token };
      copied = undefined;
      name = '';
      scopes = [];
      expires = '';
      await refresh();
    } catch (error) {
      failure = failureOf(error);
    } finally {
      busy = false;
    }
  }

  async function rotate(id: string) {
    failure = undefined;
    try {
      const made = await unwrap(
        api.POST('/tokens/{id}/rotate', { params: { path: { id } }, body: {} }),
      );
      shown = { name: made.name, secret: made.token };
      copied = undefined;
      await refresh();
    } catch (error) {
      failure = failureOf(error);
    }
  }

  async function revoke(id: string) {
    failure = undefined;
    asking = undefined;
    try {
      await unwrap(api.DELETE('/tokens/{id}', { params: { path: { id } } }));
      await refresh();
    } catch (error) {
      failure = failureOf(error);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown!.secret);
      copied = 'yes';
    } catch {
      copied = 'no';
    }
  }

  const dismiss = () => {
    shown = undefined;
    copied = undefined;
  };
</script>

<section class="card bg-base-100 border-base-300 border" aria-labelledby="tokens-title">
  <div class="card-body gap-4">
    <h2 id="tokens-title" class="card-title">{t('profile.tokens.title')}</h2>
    <p>{t('profile.tokens.lead')}</p>

    {#if shown}
      <div class="alert alert-warning flex-col items-start" role="status">
        <p class="font-medium">{t('profile.tokens.secretTitle', { name: shown.name })}</p>
        <p>{t('profile.tokens.secretWarning')}</p>
        <code
          class="bg-base-100 text-base-content w-full rounded p-2 break-all"
          data-testid="token-secret">{shown.secret}</code
        >
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-sm" onclick={copy}>{t('profile.tokens.copy')}</button
          >
          <button type="button" class="btn btn-sm btn-ghost" onclick={dismiss}>
            {t('profile.tokens.dismiss')}
          </button>
          {#if copied === 'yes'}<span role="status">{t('profile.tokens.copied')}</span>{/if}
          {#if copied === 'no'}<span role="status">{t('profile.tokens.copyFailed')}</span>{/if}
        </div>
      </div>
    {/if}

    {#if failure && (failure.status === 409 || failure.general.length > 0 || failure.status === 0)}
      <Alert kind="error">
        {failure.status === 409
          ? t('profile.tokens.conflict')
          : failure.status === 0
            ? t('profile.network')
            : failure.general.join(' ')}
      </Alert>
    {/if}

    {#if tokens.length === 0}
      <p>{t('profile.tokens.empty')}</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table">
          <caption class="sr-only">{t('profile.tokens.title')}</caption>
          <thead class="text-base-content">
            <tr>
              <th scope="col">{t('profile.tokens.name')}</th>
              <th scope="col">{t('profile.tokens.prefix')}</th>
              <th scope="col">{t('profile.tokens.scopes')}</th>
              <th scope="col">{t('profile.tokens.expires')}</th>
              <th scope="col">{t('profile.tokens.lastUsed')}</th>
              <th scope="col"><span class="sr-only">{t('profile.tokens.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {#each tokens as token (token.id)}
              <tr>
                <th scope="row">{token.name}</th>
                <td><code>{token.prefix}</code></td>
                <td class="max-w-xs break-all">{token.scopes.join(', ')}</td>
                <td
                  >{#if token.expiresAt}<Time iso={token.expiresAt} />{:else}{t(
                      'profile.tokens.never',
                    )}{/if}</td
                >
                <td
                  >{#if token.lastUsedAt}<Time iso={token.lastUsedAt} />{:else}{t(
                      'profile.tokens.unused',
                    )}{/if}</td
                >
                <td class="whitespace-nowrap">
                  {#if asking === token.id}
                    <button
                      type="button"
                      class="btn btn-error btn-xs"
                      aria-label={t('profile.tokens.confirmRevoke', { name: token.name })}
                      onclick={() => revoke(token.id)}
                    >
                      {t('profile.tokens.confirm')}
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => (asking = undefined)}
                    >
                      {t('profile.tokens.cancel')}
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      aria-label={t('profile.tokens.rotateNamed', { name: token.name })}
                      onclick={() => rotate(token.id)}
                    >
                      {t('profile.tokens.rotate')}
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      aria-label={t('profile.tokens.revokeNamed', { name: token.name })}
                      onclick={() => (asking = token.id)}
                    >
                      {t('profile.tokens.revoke')}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <form
      method="post"
      onsubmit={create}
      class="flex flex-col gap-4"
      aria-labelledby="new-token-title"
    >
      <h3 id="new-token-title" class="font-semibold">{t('profile.tokens.new')}</h3>
      <TextField
        label={t('profile.tokens.name')}
        name="tokenName"
        autocomplete="off"
        bind:value={name}
        errors={failure?.fields.name ?? []}
        required
        maxlength={64}
      />
      <fieldset class="flex flex-col gap-1">
        <legend class="text-sm font-medium">{t('profile.tokens.scopes')}</legend>
        <p class="text-sm opacity-70">{t('profile.tokens.scopesHint')}</p>
        {#each permissions as permission (permission.id)}
          <label class="flex items-start gap-2">
            <input
              type="checkbox"
              class="checkbox checkbox-sm mt-1"
              value={permission.id}
              bind:group={scopes}
            />
            <span class="flex flex-col">
              <code class="text-sm">{permission.id}</code>
              <span class="text-sm opacity-80">{permission.description}</span>
            </span>
          </label>
        {/each}
        {#if failure?.fields.scopes}
          <p class="text-error text-sm">{failure.fields.scopes.join(' ')}</p>
        {/if}
      </fieldset>
      <TextField
        label={t('profile.tokens.expiresOn')}
        type="date"
        name="expires"
        autocomplete="off"
        bind:value={expires}
        errors={failure?.fields.expiresAt ?? []}
        hint={t('profile.tokens.expiresHint')}
      />
      <div><SubmitButton {busy}>{t('profile.tokens.create')}</SubmitButton></div>
    </form>
  </div>
</section>
