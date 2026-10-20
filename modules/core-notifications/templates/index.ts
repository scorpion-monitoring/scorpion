// The templates this module ships for modules that do not exist yet. Each is registered in
// `notify.template` and tested; the owning module only enqueues it. (The membership templates moved to
// registry.organisations in M6, with the same keys; `kpi.reporting-reminder` moved to kpi.ingestion in M10, with the same key.)
import { applicationDecided, applicationSubmitted } from './onboarding.ts';

export const SHIPPED_TEMPLATES = [applicationSubmitted, applicationDecided];
