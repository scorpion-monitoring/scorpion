<script lang="ts">
  // The start page. Signed in: the dashboard, at the full width, with no banner above it. A visitor: an introduction to
  // what the software is and what it offers, with the ways in (sign in, the public catalogue, the API documentation).
  // The names come from the branding settings; the words about the software are texts of the catalogue.
  import { getShell, Icon } from '@scorpion/ui-kit';
  import Dashboard from './Dashboard.svelte';
  import type { HomeData } from './home.ts';

  let { data }: { data: HomeData } = $props();
  const { t, branding, session, href } = getShell();
  const who = $derived(session());

  const features = [
    { id: 'registry', icon: 'list' },
    { id: 'kpi', icon: 'chart' },
    { id: 'api', icon: 'book' },
  ] as const;
  const steps = ['collect', 'report', 'share'] as const;
</script>

<svelte:head>
  <title>{branding().instanceName}</title>
</svelte:head>

{#if who}
  {#if data.dashboard}
    <Dashboard initial={data.dashboard} />
  {/if}
{:else}
  <div class="mx-auto flex max-w-6xl flex-col gap-12">
    <section class="hero bg-base-200 rounded-box px-4 py-16" aria-labelledby="intro-title">
      <div class="hero-content flex-col text-center">
        <p class="text-primary text-sm font-semibold uppercase tracking-wide">
          {t('home.about.kicker', { name: branding().instanceName })}
        </p>
        <h1 id="intro-title" class="max-w-3xl text-4xl font-bold sm:text-5xl">
          {t('home.about.title', { product: branding().productName })}
        </h1>
        <p class="max-w-2xl text-lg">
          {t('home.about.lead', { product: branding().productName })}
        </p>
        <div class="mt-2 flex flex-wrap justify-center gap-3">
          <a class="btn btn-primary" href={href('/login')}>{t('app.account.signIn')}</a>
          <a class="btn" href={href('/catalog/services')}>{t('home.about.browse')}</a>
          <a class="btn btn-ghost" href={href('/docs')}>{t('home.about.docs')}</a>
        </div>
      </div>
    </section>

    <section aria-labelledby="offers-title" class="flex flex-col gap-6">
      <h2 id="offers-title" class="text-2xl font-bold">{t('home.about.offers')}</h2>
      <ul class="grid gap-4 md:grid-cols-3">
        {#each features as feature (feature.id)}
          <li class="card bg-base-100 border-base-300 border">
            <div class="card-body gap-2">
              <span
                class="bg-primary/10 text-primary inline-flex size-10 items-center justify-center rounded-lg"
              >
                <Icon name={feature.icon} size={22} />
              </span>
              <h3 class="card-title">{t(`home.about.${feature.id}.title`)}</h3>
              <p>{t(`home.about.${feature.id}.text`)}</p>
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <section aria-labelledby="how-title" class="flex flex-col gap-6">
      <h2 id="how-title" class="text-2xl font-bold">{t('home.about.how')}</h2>
      <ol class="grid gap-4 md:grid-cols-3">
        {#each steps as step, index (step)}
          <li class="flex gap-3">
            <span
              class="bg-primary text-primary-content inline-flex size-8 shrink-0 items-center justify-center rounded-full font-bold"
              aria-hidden="true">{index + 1}</span
            >
            <div>
              <h3 class="font-semibold">{t(`home.about.step.${step}.title`)}</h3>
              <p>{t(`home.about.step.${step}.text`)}</p>
            </div>
          </li>
        {/each}
      </ol>
    </section>

    <section
      class="bg-base-200 rounded-box flex flex-col items-center gap-3 px-4 py-10 text-center"
    >
      <h2 class="text-2xl font-bold">{t('home.about.cta.title')}</h2>
      <p class="max-w-xl">{t('home.about.cta.text')}</p>
      <a class="btn btn-primary" href={href('/register')}>{t('home.about.cta.register')}</a>
    </section>
  </div>
{/if}
