// The settings of registry.organisations. Nothing secret lives here.
import { z } from '@scorpion/contracts';

/** The defaults, named so a test and the README can refer to them. */
export const DEFAULT_MAX_PENDING_PER_USER = 10;
export const DEFAULT_MAX_MANAGERS_PER_ORGANISATION = 20;

const membership = z.strictObject({
  /** Open requests (`requested`) one person may have at once; the next is `409 too-many-pending`. */
  maxPendingPerUser: z.number().int().min(1).max(100).default(DEFAULT_MAX_PENDING_PER_USER).meta({
    title: 'Open membership requests per person',
    description:
      'How many requests a person may have waiting at once. A request over the limit is refused until one is decided or withdrawn.',
  }),
  /** Whether an approved member sees who else is a member (usernames and join dates, never an address). */
  membersVisibleToMembers: z.boolean().default(true).meta({
    title: 'Members see each other',
    description:
      'On: an approved member sees the usernames and join dates of the other members of their organisation. Managers and administrators always do. Never an email address.',
  }),
  /** Bounds the mail a request sends: every manager of the organisation is mailed. */
  maxManagersPerOrganisation: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_MAX_MANAGERS_PER_ORGANISATION)
    .meta({
      title: 'Managers per organisation',
      description:
        'The most managers one organisation may have. A promotion over the limit is refused. Every manager is mailed when somebody asks to join, so the limit bounds that mail.',
    }),
});

export const settingsSchema = z.strictObject({
  /**
   * Whether every signed-in person sees the contact point of an organisation. Off: only administrators
   * and the managers of that organisation do. Never public, never in a list.
   */
  exposeContactPoint: z.boolean().default(true).meta({
    title: 'Show organisation contact points',
    description:
      'An organisation may enter a shared contact address (not a person’s). On: every signed-in person sees it on the organisation and in its Schema.org profile. Off: only administrators and the managers of that organisation do.',
  }),
  /** Limits and visibility of membership (M6 sprint 3). */
  membership: membership
    .default(() => membership.parse({}))
    .meta({
      title: 'Membership',
      description: 'Who may ask to join an organisation, how often, and who sees the members.',
    }),
});

export type OrganisationsSettings = z.output<typeof settingsSchema>;
