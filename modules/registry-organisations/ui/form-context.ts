// What the widgets of the organisation form need besides their value: the registered types. The form puts
// them into Svelte's context, the widget reads them; a widget gets no other props from `SchemaForm`.
import { getContext, setContext } from 'svelte';

export interface TypeChoice {
  id: string;
  label: string;
  /** Whether people may become members of an organisation of this type. */
  membership: boolean;
}

const KEY = Symbol('registry.organisations.types');

export const setTypeChoices = (types: readonly TypeChoice[]) => setContext(KEY, types);
export const getTypeChoices = (): readonly TypeChoice[] =>
  getContext<readonly TypeChoice[] | undefined>(KEY) ?? [];
