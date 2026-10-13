<script lang="ts">
  // The public page of a service: what a Reviewer made public, for anyone, signed in or not. NOTHING here is
  // drawn from a role or a session: the page reads `t` and `href` of the shell and the one answer of the public
  // route, never `session()` or `navigation()`, so it is the same page for every visitor. There is no edit,
  // no member, no contact point and no publish control: the public record does not hold them. The provider and the
  // groups link to their public pages (an organisation of a public service is public). The Schema.org block in
  // the head is rendered on the server by the one audited component (ui-kit's `JsonLd.svelte`).
  import { serializeJsonLd } from '@scorpion/registry-organisations/public';
  import { getShell, JsonLd } from '@scorpion/ui-kit';
  import type { PublicServiceData } from './loaders.ts';

  let { data }: { data: PublicServiceData } = $props();
  const { t, href } = getShell();

  const service = $derived(data.service);
  /** The page of the licence, from the profile: it names one only for an id the SPDX list knows. */
  const licenceUrl = $derived(data.profile.license);
  const groups = $derived(
    [
      { id: 'owner', heading: t('services.owner'), organisations: [service.provider] },
      { id: 'group', heading: t('services.group'), organisations: service.consortia },
    ].filter((group) => group.organisations.length > 0),
  );
</script>

<svelte:head>
  <title>{service.name}</title>
</svelte:head>
<JsonLd json={serializeJsonLd(data.profile)} />

<article class="flex max-w-3xl flex-col gap-6">
  <header class="flex flex-wrap items-center gap-4">
    {#if service.logoUrl}
      <img
        class="bg-base-200 h-20 w-auto max-w-xs rounded p-2"
        src={service.logoUrl}
        alt={t('services.icon.alt', { name: service.name })}
      />
    {/if}
    <h1 class="text-2xl font-bold">{service.name}</h1>
  </header>

  {#if service.description}
    <p class="whitespace-pre-line">{service.description}</p>
  {/if}

  <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
    <dt class="font-medium">{t('services.detail.shortName')}</dt>
    <dd>{service.slug}</dd>
    <dt class="font-medium">{t('services.detail.stage')}</dt>
    <dd>{service.stage}</dd>
    {#if service.license}
      <dt class="font-medium">{t('services.detail.license')}</dt>
      <dd>
        {#if licenceUrl}
          <a class="link" href={licenceUrl} rel="noopener noreferrer">{service.license}</a>
        {:else}
          {service.license}
        {/if}
      </dd>
    {/if}
    {#each groups as group (group.id)}
      <dt class="font-medium">{group.heading}</dt>
      <dd>
        <ul class="list-none">
          {#each group.organisations as organisation (organisation.id)}
            <li>
              <a class="link" href={href(`/public/organisations/${organisation.id}`)}
                >{organisation.name}</a
              >
            </li>
          {/each}
        </ul>
      </dd>
    {/each}
    {#if service.url}
      <dt class="font-medium">{t('services.detail.url')}</dt>
      <dd><a class="link" href={service.url} rel="noopener noreferrer">{service.url}</a></dd>
    {/if}
    {#if service.sameAs.length > 0}
      <dt class="font-medium">{t('services.detail.sameAs')}</dt>
      <dd>
        <ul class="list-none">
          {#each service.sameAs as link (link)}
            <li><a class="link" href={link} rel="noopener noreferrer">{link}</a></li>
          {/each}
        </ul>
      </dd>
    {/if}
  </dl>
</article>
