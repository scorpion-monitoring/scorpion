// The page the component specs open: `?scene=<name>` mounts one scene inside a stand-in for the shell's
// layout. Built and served by `e2e/support/harness.ts`; nothing of it ships.
import { mount, type Component } from 'svelte';
import './harness.css';
import Root from './Root.svelte';

const scenes = import.meta.glob<{ default: unknown }>('./scenes/*.svelte');

const params = new URLSearchParams(window.location.search);
const name = params.get('scene') ?? '';
const key = `./scenes/${name}.svelte`;
// Only a scene that exists: the name comes from the address.
const load = Object.hasOwn(scenes, key) ? scenes[key] : undefined;
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark')
  document.documentElement.dataset.theme = `scorpion${theme}`;
// `?colors=custom` links the instance's theme stylesheet as the layout does (ADR-0051); the spec answers `./theme.css` with the sheet of a
// custom set. The scene mounts once it has loaded, as the app's first paint follows its stylesheets.
if (params.get('colors') === 'custom') {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './theme.css';
  const loaded = new Promise((done) => link.addEventListener('load', done, { once: true }));
  document.head.append(link);
  await loaded;
}

mount(Root, {
  target: document.getElementById('app')!,
  props: {
    scene: load ? ((await load()).default as Component) : undefined,
    name,
    locale: params.get('lang') ?? 'en',
  },
});
