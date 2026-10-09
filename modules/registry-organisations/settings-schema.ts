// The settings of registry.organisations. The membership limits arrive with sprint 3. Nothing secret
// lives here.
import { z } from '@scorpion/contracts';

export const settingsSchema = z.strictObject({
  /**
   * Whether every signed-in person sees the contact point of an organisation. Off: only administrators
   * (and, from sprint 3, the managers of that organisation) do. Never public, never in a list.
   */
  exposeContactPoint: z.boolean().default(true).meta({
    title: 'Show organisation contact points',
    description:
      'An organisation may enter a shared contact address (not a person’s). On: every signed-in person sees it on the organisation and in its Schema.org profile. Off: only administrators do.',
  }),
});

export type OrganisationsSettings = z.output<typeof settingsSchema>;
