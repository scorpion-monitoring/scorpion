// The templates this module ships for modules that do not exist yet. Each is registered in
// `notify.template` and tested; the owning module only enqueues it.
import { applicationDecided, applicationSubmitted } from './onboarding.ts';
import { reportingReminder } from './kpi.ts';
import { membershipDecided, membershipRequested } from './registry.ts';

export const SHIPPED_TEMPLATES = [
  membershipRequested,
  membershipDecided,
  applicationSubmitted,
  applicationDecided,
  reportingReminder,
];
