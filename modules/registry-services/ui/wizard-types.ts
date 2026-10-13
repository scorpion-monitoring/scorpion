// What the wizard's page holds, as plain types: the answer of `GET /services/schema` (the loader hands the
// typed client's answer to these, so a change of the route that the page cannot read fails the type check)
// and the lists the loader asked for. No Svelte here; the pure helpers of `form-state.ts` use them too.
import type { JsonSchema } from '@scorpion/ui-kit/json-schema';

export interface WizardChoice {
  value: string;
  label?: string | undefined;
  labelKey?: string | undefined;
}

export interface WizardField {
  key: string;
  /** A JSON pointer into the one nested form object. */
  path: string;
  type: string;
  widget: string;
  label: string;
  help?: string | undefined;
  required: boolean;
  default?: unknown;
  config: Record<string, unknown>;
  role?: string | undefined;
  column?: string | undefined;
  /** Not part of the create body (the icon). */
  deferred: boolean;
  choices?: WizardChoice[] | undefined;
}

export interface WizardStep {
  id: string;
  order: number;
  title: string;
  intro: string[];
  component?: string | undefined;
  contributed: boolean;
  fields: WizardField[];
  schema: JsonSchema;
}

export interface WizardRole {
  id: string;
  label: string;
  orgTypes: string[];
  min: number;
  max: number;
  order: number;
  /** The caller may only choose an organisation they are an approved member of (an administrator any). */
  memberOnly: boolean;
}

export interface WizardLimits {
  sameAs: number;
  slug: number;
  name: number;
  description: number;
  url: number;
  email: number;
  contactKind: number;
  bodyBytes: number;
}

export interface WizardSchema {
  steps: WizardStep[];
  limits: WizardLimits;
  fieldTypes: { id: string; widget: string }[];
  roles: WizardRole[];
  defaults: Record<string, unknown>;
  devConsole: boolean;
}

export interface OrganisationOption {
  id: string;
  abbreviation: string;
  name: string;
}

/** The organisations one role may choose from, as the API listed them for this caller. */
export interface OrganisationChoices {
  options: OrganisationOption[];
  /** The API holds more than it returned (it never returns more than 100). */
  truncated: boolean;
}

export interface WizardData {
  schema: WizardSchema;
  /** By role id. */
  organisations: Record<string, OrganisationChoices>;
}
