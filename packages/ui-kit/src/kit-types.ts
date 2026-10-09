// The shapes the shared components take, kept out of the `.svelte` files so a page can import them.
import type { FieldNode } from './schema-form.ts';

export interface Crumb {
  label: string;
  href?: string;
}

export interface TabItem {
  id: string;
  label: string;
}

export interface WizardStep {
  id: string;
  label: string;
}

/** What a custom widget of a `SchemaForm` (`widget: 'logo'` in the schema) is given. */
export interface WidgetProps {
  node: FieldNode;
  value: unknown;
  onchange: (value: unknown) => void;
  errors: readonly string[];
  disabled: boolean;
}
