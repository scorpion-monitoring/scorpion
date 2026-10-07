import { ApiError, unwrap, type ApiClient, type Branding } from '@scorpion/contracts/client';

/** What a page shows when the profile has no `core.settings` (no `/branding` route): the product, nothing more. */
export const DEFAULT_BRANDING: Branding = {
  productName: 'Scorpion',
  instanceName: 'Scorpion',
  contactEmail: null,
  imprintUrl: null,
  logos: { light: null, dark: null },
  legalPages: [],
};

export async function loadBranding(api: ApiClient): Promise<Branding> {
  try {
    return await unwrap(api.GET('/branding'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return DEFAULT_BRANDING;
    throw error;
  }
}
