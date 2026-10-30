import type { UiLoadContext } from '@scorpion/contracts';
import { unwrap } from '@scorpion/contracts/client';

export interface AboutData {
  profile: string;
  version: string;
  modules: { id: string; displayName: string; version: string; kind: 'core' | 'optional' }[];
}

/** The profile, the version and the modules of this instance (`GET /ui/about`, ADR-0045). A failure throws (defect 12). */
export async function loadAbout({ api }: UiLoadContext): Promise<AboutData> {
  return unwrap(api.GET('/ui/about'));
}
