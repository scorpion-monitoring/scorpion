<script lang="ts">
  // The form of an organisation, for one editor group: it draws the fields the caller may write
  // (`editableFields` of the API) and nothing else, with ui-kit's `SchemaForm`, and sends what changed. The
  // server still judges every value and every right; a 403 or a 422 is shown in words on the form. Used by
  // the administrator's editor and (sprint 5) the manager's form.
  import {
    SchemaForm,
    failureMessage,
    failureOf,
    getShell,
    type FormFailure,
  } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import { setTypeChoices, type TypeChoice } from './form-context.ts';
  import { organisationFormSchema, type FormField, type FormMode } from './form-schema.ts';
  import OrgTypeWidget from './OrgTypeWidget.svelte';
  import RorWidget from './RorWidget.svelte';
  import { referenceBlock } from './errors.ts';
  import {
    buildCreate,
    buildPatch,
    formValues,
    type OrganisationValues,
    type StoredOrganisation,
  } from './patch.ts';

  interface Saved extends StoredOrganisation {
    id: string;
  }

  let {
    mode,
    types,
    fields,
    stored,
    onsaved,
  }: {
    mode: FormMode;
    types: readonly TypeChoice[];
    /** The fields the caller may write: all for an administrator, `editableFields` for a manager. */
    fields: readonly FormField[];
    /** The record being edited (edit mode). */
    stored?: Saved | undefined;
    onsaved?: (saved: Saved) => void | Promise<void>;
  } = $props();
  const { t, api, toaster } = getShell();

  // The widgets read the types from the context; the form hands them over once.
  // svelte-ignore state_referenced_locally
  setTypeChoices(types);

  const schema = $derived(organisationFormSchema({ t, fields, mode }));
  let current = $state<Saved | undefined>();
  const record = $derived(current ?? stored);
  const values = $derived<OrganisationValues>(record ? formValues(record) : {});
  let busy = $state(false);
  let failure = $state<FormFailure>();

  const generalFailure = (error: unknown): FormFailure => {
    const base = failureOf(error);
    const block = referenceBlock(error);
    if (block) {
      return {
        ...base,
        general: [
          block.modules.length > 0
            ? t('organisation.type.inUse', { modules: block.modules.join(', ') })
            : t('organisation.type.inUse.unnamed'),
        ],
      };
    }
    // A request that names a field the caller may not write, or an organisation they may not edit.
    if (base.status === 403) return { ...base, general: [t('organisation.form.forbidden')] };
    if (base.fields && Object.keys(base.fields).length === 0 && base.general.length === 0) {
      return { ...base, general: [failureMessage(base, t)] };
    }
    return base;
  };

  async function submit(raw: unknown) {
    const given = (raw ?? {}) as OrganisationValues;
    failure = undefined;
    busy = true;
    try {
      let saved: Saved;
      if (mode === 'create') {
        saved = await unwrap(api.POST('/organisations', { body: buildCreate(given) }));
        toaster.success(t('organisation.form.created', { name: saved.name }));
      } else if (record) {
        const patch = buildPatch(record, given, fields);
        if (Object.keys(patch).length === 0) {
          toaster.info(t('organisation.form.nothingChanged'));
          return;
        }
        saved = await unwrap(
          api.PATCH('/organisations/{id}', {
            params: { path: { id: record.id } },
            body: patch,
          }),
        );
        current = saved;
        toaster.success(t('organisation.form.saved'));
      } else {
        return;
      }
      await onsaved?.(saved);
    } catch (error) {
      failure = generalFailure(error);
    } finally {
      busy = false;
    }
  }
</script>

<SchemaForm
  {schema}
  value={values}
  {failure}
  {busy}
  onsubmit={submit}
  submitLabel={mode === 'create' ? t('organisation.form.create') : t('organisation.form.save')}
  widgets={{ orgType: OrgTypeWidget, ror: RorWidget }}
/>
