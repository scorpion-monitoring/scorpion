// The templates this module ships for modules that do not exist yet. Each is registered in
// `notify.template` and tested; the owning module only enqueues it. (The membership templates moved to
// registry.organisations in M6, with the same keys.)
import { applicationDecided, applicationSubmitted } from './onboarding.ts';
import { reportingReminder } from './kpi.ts';

export const SHIPPED_TEMPLATES = [applicationSubmitted, applicationDecided, reportingReminder];
