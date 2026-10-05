import { z } from '@scorpion/contracts';

/** The registry through which a module that knows people (core.identity) tells this one an address. */
export const RECIPIENT_ADDRESS_REGISTRY = 'notify.recipientAddress';
export const recipientAddressEntrySchema = z.strictObject({
  id: z.string().min(1).max(100),
  /** The address of a user, or `null` when the user has none (or does not exist). */
  addressOf: z.custom<(userId: string) => Promise<string | null>>(
    (value) => typeof value === 'function',
    'expected a function',
  ),
});
export type RecipientAddressEntry = z.infer<typeof recipientAddressEntrySchema>;
