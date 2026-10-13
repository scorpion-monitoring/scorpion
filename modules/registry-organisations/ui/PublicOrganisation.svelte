<script lang="ts">
  // The public page of an organisation that a public service names: its public record and the public services
  // that name it. NOTHING here is drawn from a role or a session: the page reads `t` and `href` of the shell,
  // never `session()` or `navigation()`. No members, no contact point, no edit and no membership control: the
  // public record does not hold them. A service is listed only by the module that owns services, which also owns
  // its public page, so the link is always to a page that exists. The Schema.org block in the head is rendered on
  // the server by the one audited component (ui-kit's `JsonLd.svelte`).
  import { getShell, JsonLd } from '@scorpion/ui-kit';
  import type { PublicOrganisationData } from './loaders.ts';
  import { serializeJsonLd } from '../service/schema-org.ts';
  import { rorLink } from './ror.ts';

  let { data }: { data: PublicOrganisationData } = $props();
  const { t, href } = getShell();

  const organisation = $derived(data.organisation);
</script>

<svelte:head>
  <title>{organisation.name}</title>
</svelte:head>
<JsonLd json={serializeJsonLd(data.profile)} />

<article class="flex max-w-3xl flex-col gap-6">
  <header class="flex flex-wrap items-center gap-4">
    {#if organisation.logoUrl}
      <img
        class="bg-base-200 h-20 w-auto max-w-xs rounded p-2"
        src={organisation.logoUrl}
        alt={t('organisation.logo.alt', { name: organisation.name })}
      />
    {/if}
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">{organisation.name}</h1>
      <p class="font-medium">{organisation.abbreviation}</p>
    </div>
  </header>

  {#if organisation.description}
    <p class="whitespace-pre-line">{organisation.description}</p>
  {/if}

  <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
    {#if organisation.website}
      <dt class="font-medium">{t('organisation.website')}</dt>
      <dd>
        <a class="link" href={organisation.website} rel="noopener noreferrer"
          >{organisation.website}</a
        >
      </dd>
    {/if}
    {#if organisation.rorId}
      <dt class="font-medium">{t('organisation.rorId')}</dt>
      <dd>
        <a class="link" href={rorLink(organisation.rorId)} rel="noopener noreferrer"
          >{organisation.rorId}</a
        >
      </dd>
    {/if}
    {#if organisation.sameAs.length > 0}
      <dt class="font-medium">{t('organisation.sameAs')}</dt>
      <dd>
        <ul class="list-none">
          {#each organisation.sameAs as link (link)}
            <li><a class="link" href={link} rel="noopener noreferrer">{link}</a></li>
          {/each}
        </ul>
      </dd>
    {/if}
  </dl>

  <section class="flex flex-col gap-2" aria-labelledby="org-public-services">
    <h2 id="org-public-services" class="text-lg font-semibold">
      {t('organisation.public.services')}
    </h2>
    {#if organisation.services.length === 0}
      <p class="opacity-70">{t('organisation.public.noServices')}</p>
    {:else}
      <ul class="list-none">
        {#each organisation.services as service (service.id)}
          <li>
            <a class="link" href={href(`/public/services/${encodeURIComponent(service.slug)}`)}
              >{service.name}</a
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</article>
