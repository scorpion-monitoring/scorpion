// The settings of registry.services. Nothing secret lives here.
import { z } from '@scorpion/contracts';

export const settingsSchema = z.strictObject({
  /**
   * Whether every signed-in person sees the contact point of a service. Off: only administrators (and, from
   * sprint 2, the provider's members) do. Never public, never in a list, never in the Schema.org profile.
   */
  exposeContactPoint: z.boolean().default(true).meta({
    title: 'Show service contact points',
    description:
      'A service may enter a shared contact address (not a person’s). On: every signed-in person sees it on the service page. Off: only administrators and the members of the provider do. It is never public and never part of the Schema.org profile.',
  }),
  /** Whether the instance may serve public services at all (sprints 2 and 3). */
  allowPublic: z.boolean().default(true).meta({
    title: 'Allow public services',
    description:
      'On: Reviewers and administrators may make a service public, and anybody may then read its name, description, links, provider and consortia. Off: every public address answers “not found” and publishing is refused. Services already marked public stay marked, and are served again when this is switched back on.',
  }),
});

export type ServicesSettings = z.output<typeof settingsSchema>;
