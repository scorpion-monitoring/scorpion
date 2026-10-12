// The fields of a service: where each one lives in the form (`path`, a JSON pointer into the one nested
// object the wizard edits), what kind it is (`type`, an entry of `service.fieldType`), its message keys
// and where its value is stored. The successor of `service_schema.json`. A deployment adds a field by
// adding an entry here and rebuilding; a field that is not a column of `svc_service` uses
// `storage: { kind: 'value' }` and lands in `svc_field_value` (ADR-0035).
//
// The validator refuses to start the server with a message naming this file and the field when an entry is wrong.
import type { FieldConfig } from './types.ts';

export const FIELDS: readonly FieldConfig[] = [
  {
    key: 'slug',
    path: '/slug',
    type: 'text',
    label: 'services.field.slug.label',
    help: 'services.field.slug.help',
    required: true,
    config: { format: 'slug' },
    storage: { kind: 'column', column: 'slug' },
  },
  {
    key: 'name',
    path: '/name',
    type: 'text',
    label: 'services.field.name.label',
    required: true,
    config: { format: 'name' },
    storage: { kind: 'column', column: 'name' },
  },
  {
    key: 'license',
    path: '/license',
    type: 'license',
    label: 'services.field.license.label',
    help: 'services.field.license.help',
    storage: { kind: 'column', column: 'license' },
  },
  {
    key: 'stage',
    path: '/stage',
    type: 'select',
    label: 'services.field.stage.label',
    required: true,
    default: 'DEV',
    config: { vocabulary: 'stage' },
    storage: { kind: 'column', column: 'stage' },
  },
  {
    key: 'icon',
    path: '/icon',
    type: 'image',
    label: 'services.field.icon.label',
    help: 'services.field.icon.help',
    storage: { kind: 'icon' },
  },
  {
    key: 'description',
    path: '/description',
    type: 'text',
    label: 'services.field.description.label',
    config: { format: 'description' },
    storage: { kind: 'column', column: 'description' },
  },
  {
    key: 'url',
    path: '/url',
    type: 'text',
    label: 'services.field.url.label',
    config: { format: 'url' },
    storage: { kind: 'column', column: 'url' },
  },
  {
    key: 'sameAs',
    path: '/sameAs',
    type: 'text',
    label: 'services.field.sameAs.label',
    help: 'services.field.sameAs.help',
    config: { format: 'url', multiple: true },
    storage: { kind: 'column', column: 'sameAs' },
  },
  {
    key: 'provider',
    path: '/provider',
    type: 'organisation',
    label: 'services.field.provider.label',
    help: 'services.field.provider.help',
    required: true,
    storage: { kind: 'organisations', role: 'provider' },
  },
  {
    key: 'consortia',
    path: '/consortia',
    type: 'organisation',
    label: 'services.field.consortia.label',
    help: 'services.field.consortia.help',
    config: { multiple: true },
    storage: { kind: 'organisations', role: 'consortium' },
  },
  {
    key: 'contactEmail',
    path: '/contact/email',
    type: 'text',
    label: 'services.field.contactEmail.label',
    help: 'services.field.contactEmail.help',
    config: { format: 'email' },
    storage: { kind: 'column', column: 'contactEmail' },
  },
  {
    key: 'contactType',
    path: '/contact/type',
    type: 'text',
    label: 'services.field.contactType.label',
    config: { format: 'contact-type' },
    storage: { kind: 'column', column: 'contactType' },
  },
];
