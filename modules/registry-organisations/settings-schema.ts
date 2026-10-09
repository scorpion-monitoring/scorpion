// The settings of registry.organisations. Sprint 1 has none; the contact-point switch and the
// membership limits arrive with sprints 2 and 3. Nothing secret lives here.
import { z } from '@scorpion/contracts';

export const settingsSchema = z.strictObject({});

export type OrganisationsSettings = z.output<typeof settingsSchema>;
