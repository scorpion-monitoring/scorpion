// The steps of the create wizard, in order: the successor of `steps.json`. A step lists the keys of its
// fields (`config/fields.ts`); `intro` holds the message keys of the paragraphs shown above them (the
// legacy `texts`). Other modules contribute more steps through the registry `service.wizardStep` (M9: the
// category). A step needs a field list or a `component`; the validator refuses a step order that clashes.
import type { StepConfig } from './types.ts';

export const STEPS: readonly StepConfig[] = [
  {
    id: 'basics',
    order: 10,
    title: 'services.step.basics.title',
    intro: ['services.step.basics.intro'],
    fields: ['slug', 'name', 'license', 'stage', 'icon', 'description', 'url', 'sameAs'],
  },
  {
    id: 'provision',
    order: 20,
    title: 'services.step.provision.title',
    intro: ['services.step.provision.intro'],
    fields: ['provider', 'consortia'],
  },
  {
    id: 'contact',
    order: 30,
    title: 'services.step.contact.title',
    intro: ['services.step.contact.intro'],
    fields: ['contactEmail', 'contactType'],
  },
];
