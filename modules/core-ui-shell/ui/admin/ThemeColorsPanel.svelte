<script lang="ts">
  // The colours of one theme, a tab of `ThemeColorsWidget` (M12a sprint 4): one row per daisyUI token from the schema's own fields, a
  // colour picker and a `#rrggbb` field each, the contrast pairs that would be refused (the same check the server runs on save), a reset
  // to the built-in colours, and a preview. The preview is an SVG whose colours are `fill` attributes, not inline style, so the page's
  // policy (no 'unsafe-inline') is untouched. Nothing here is sent until the form is saved.
  import { getShell, type WidgetProps } from '@scorpion/ui-kit';
  import {
    COLOR_TOKENS,
    cleanThemeColors,
    contrastFailures,
    formatRatio,
    isHexColor,
    resolveTheme,
    type ColorToken,
    type ThemeMode,
  } from '@scorpion/contracts/theme-colors';

  // The server's messages are not repeated here: the live list below runs the same check and stays current while the person edits,
  // and the form's summary at the top keeps what the server said.
  let { node, value, onchange, disabled }: Omit<WidgetProps, 'errors'> = $props();
  const { t } = getShell();
  const id = $props.id();

  const mode = $derived<ThemeMode>(node.key === 'dark' ? 'dark' : 'light');
  const set = $derived(cleanThemeColors(value));
  const resolved = $derived(resolveTheme(mode, set));
  const colors = $derived(resolved.colors);
  const failures = $derived(contrastFailures(mode, set));
  const empty = $derived(Object.keys(set).length === 0);
  /** The tokens the schema offers, in the order of `COLOR_TOKENS` (a token the schema does not name is not drawn). */
  const tokens = $derived(
    COLOR_TOKENS.filter((token) => node.children.some((child) => child.key === token)),
  );

  /** What was typed into a field and is not yet a colour; it stays in the field and is not stored. */
  let typed = $state<Partial<Record<ColorToken, string>>>({});

  const label = (token: ColorToken) => t(`admin.colors.token.${token}`);

  function store(token: ColorToken, next: string | undefined) {
    const rest = { ...set };
    if (next === undefined) delete rest[token];
    else rest[token] = next.toLowerCase();
    onchange(rest);
  }

  function type(token: ColorToken, text: string) {
    const trimmed = text.trim();
    if (trimmed === '') {
      typed = { ...typed, [token]: undefined };
      store(token, undefined);
    } else if (isHexColor(trimmed)) {
      typed = { ...typed, [token]: undefined };
      store(token, trimmed);
    } else {
      typed = { ...typed, [token]: text };
    }
  }

  function reset() {
    typed = {};
    onchange({});
  }

  // The preview: a page, a card and a raised part with their text, the four kinds of button and the four of badge.
  const BUTTONS = ['primary', 'secondary', 'accent', 'neutral'] as const;
  const BADGES = ['info', 'success', 'warning', 'error'] as const;
</script>

<div class="flex flex-col gap-4" data-theme-colors={mode}>
  <p class="text-sm opacity-70">
    {empty
      ? t('admin.colors.builtIn')
      : t('admin.colors.custom', { count: Object.keys(set).length })}
  </p>

  <div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
    {#each tokens as token (token)}
      {@const textId = `${id}-${token}`}
      {@const hintId = `${id}-${token}-hint`}
      {@const derived = resolved.derived.includes(token)}
      {@const invalid = typed[token] !== undefined}
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for={textId}>{label(token)}</label>
        <div class="flex items-center gap-2">
          <input
            type="color"
            class="border-base-content/50 h-8 w-10 shrink-0 cursor-pointer rounded border"
            aria-label={t('admin.colors.pick', { label: label(token) })}
            value={colors[token]}
            {disabled}
            oninput={(event) => type(token, event.currentTarget.value)}
          />
          <input
            id={textId}
            type="text"
            class="input input-sm num w-28"
            class:input-error={invalid}
            maxlength="7"
            spellcheck="false"
            autocomplete="off"
            placeholder={colors[token]}
            aria-describedby={hintId}
            aria-invalid={invalid ? 'true' : undefined}
            value={typed[token] ?? set[token] ?? ''}
            {disabled}
            oninput={(event) => type(token, event.currentTarget.value)}
          />
        </div>
        <p id={hintId} class="text-xs" class:text-error={invalid} class:opacity-70={!invalid}>
          {#if invalid}
            {t('admin.colors.format')}
          {:else if set[token] !== undefined}
            {t('admin.colors.set')}
          {:else if derived}
            {t('admin.colors.derived', { color: colors[token] })}
          {:else}
            {t('admin.colors.default', { color: colors[token] })}
          {/if}
        </p>
      </div>
    {/each}
  </div>

  {#if failures.length > 0}
    <div class="alert alert-warning flex flex-col items-start" role="status">
      <p class="font-medium">{t('admin.colors.failing', { count: failures.length })}</p>
      <ul class="list-disc ps-5 text-sm">
        {#each failures as failure (`${failure.foreground}/${failure.background}`)}
          <li>
            {t('admin.colors.pair', {
              foreground: label(failure.foreground),
              background: label(failure.background),
              ratio: formatRatio(failure.ratio),
              minimum: failure.minimum,
            })}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <figure class="flex flex-col gap-1">
    <svg
      viewBox="0 0 320 156"
      class="border-base-300 w-full max-w-xl rounded-box border"
      role="img"
      aria-label={t('admin.colors.preview', { theme: t(`admin.colors.mode.${mode}`) })}
    >
      <rect width="320" height="156" fill={colors['base-100']} />
      <text x="12" y="20" font-size="12" fill={colors['base-content']}
        >{t('admin.colors.sample.page')}</text
      >
      <text x="12" y="36" font-size="12" fill={colors.primary} text-decoration="underline">
        {t('admin.colors.sample.link')}
      </text>
      <text x="120" y="36" font-size="12" fill={colors.error}>{t('admin.colors.sample.error')}</text
      >
      <rect x="8" y="46" width="148" height="44" rx="6" fill={colors['base-200']} />
      <text x="16" y="66" font-size="12" fill={colors['base-content']}
        >{t('admin.colors.sample.card')}</text
      >
      <text x="16" y="82" font-size="11" fill={colors.warning}
        >{t('admin.colors.sample.warning')}</text
      >
      <rect x="164" y="46" width="148" height="44" rx="6" fill={colors['base-300']} />
      <text x="172" y="66" font-size="12" fill={colors['base-content']}
        >{t('admin.colors.sample.raised')}</text
      >
      <rect
        x="170"
        y="72"
        width="60"
        height="12"
        rx="2"
        fill="none"
        stroke={colors.primary}
        stroke-width="2"
      />
      {#each BUTTONS as kind, index (kind)}
        <rect x={8 + index * 77} y="98" width="71" height="24" rx="6" fill={colors[kind]} />
        <text
          x={8 + index * 77 + 35.5}
          y="114"
          font-size="11"
          text-anchor="middle"
          fill={colors[`${kind}-content`]}
        >
          {t(`admin.colors.token.${kind}`)}
        </text>
      {/each}
      {#each BADGES as kind, index (kind)}
        <rect x={8 + index * 77} y="130" width="71" height="18" rx="9" fill={colors[kind]} />
        <text
          x={8 + index * 77 + 35.5}
          y="143"
          font-size="10"
          text-anchor="middle"
          fill={colors[`${kind}-content`]}
        >
          {t(`admin.colors.token.${kind}`)}
        </text>
      {/each}
    </svg>
    <figcaption class="text-xs opacity-70">{t('admin.colors.previewNote')}</figcaption>
  </figure>

  <div>
    <button type="button" class="btn btn-sm" disabled={disabled || empty} onclick={reset}>
      {t('admin.colors.reset', { theme: t(`admin.colors.mode.${mode}`) })}
    </button>
  </div>
</div>
