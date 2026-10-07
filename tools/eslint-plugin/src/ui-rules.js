// Syntax rules for the web app, the shared components and the pages of modules (M5 plan §2). They make
// the choices of ADR-0027 fail `pnpm check` instead of review: the API is called through the typed
// client, every link is built with `href()` / `url()`, and a loader throws.

const URL_ARGUMENT = '/^(Literal|TemplateLiteral|BinaryExpression)$/';

/** Where the UI code lives, and where a fixture of these rules is linted. */
export const UI_FILES = [
  'apps/web/src/**/*.{ts,svelte}',
  'packages/ui-kit/src/**/*.{ts,svelte}',
  'modules/*/ui/**/*.{ts,svelte}',
  'tools/lint-fixtures/ui/**/*.{ts,svelte}',
];

/** Code that runs in a loader or builds its answer: the places a `Response` must never come from. */
export const LOADER_FILES = [
  'apps/web/src/routes/**/+{page,layout}*.ts',
  'apps/web/src/lib/server/**/*.ts',
  'modules/*/ui/**/*.ts',
  'tools/lint-fixtures/ui/loaders/**/*.ts',
];

export const uiSelectors = [
  {
    selector: `CallExpression[callee.name='fetch'][arguments.0.type=${URL_ARGUMENT}]`,
    message:
      'Call the API through the typed client (getShell().api in a component, locals.api or the api of a load), not with a hand-written URL (ADR-0027).',
  },
  {
    selector: `CallExpression[callee.property.name='fetch'][arguments.0.type=${URL_ARGUMENT}]`,
    message:
      'Call the API through the typed client (getShell().api in a component, locals.api or the api of a load), not with a hand-written URL (ADR-0027).',
  },
  {
    selector: "CallExpression[callee.name='goto'][arguments.0.type='Literal']",
    message: 'Build the path with href() (it adds BASE_PATH), then pass it to goto().',
  },
  {
    selector: "SvelteAttribute[key.name='href'] > SvelteLiteral[value=/^\\//]",
    message:
      'Do not write a path in href: use href={href("/path")} (it adds BASE_PATH, defect 11).',
  },
  {
    selector: "SvelteAttribute[key.name='href'] > SvelteMustacheTag > Literal[value=/^\\//]",
    message:
      'Do not write a path in href: use href={href("/path")} (it adds BASE_PATH, defect 11).',
  },
  {
    selector:
      "SvelteAttribute[key.name='href'] > SvelteMustacheTag > TemplateLiteral[quasis.0.value.raw=/^\\//]",
    message:
      'Do not write a path in href: use href={href("/path")} (it adds BASE_PATH, defect 11).',
  },
];

export const loaderSelectors = [
  {
    selector: "NewExpression[callee.name='Response']",
    message: 'A loader throws (error(status, message)); it never returns a Response (defect 12).',
  },
  {
    selector: "CallExpression[callee.object.name='Response']",
    message: 'A loader throws (error(status, message)); it never returns a Response (defect 12).',
  },
  {
    selector: "CallExpression[callee.name='json']",
    message: 'A loader throws (error(status, message)); it never returns json() (defect 12).',
  },
  {
    selector: "ImportSpecifier[imported.name='json']",
    message: 'A loader throws (error(status, message)); it never returns json() (defect 12).',
  },
];
