// Writes a made-up snapshot directory with a correct manifest, as `fetch` would, for the tests that read one. Every
// name is invented.
import { join } from 'node:path';
import { sha256, writePrivateFile } from '../src/files.ts';
import type {
  LegacyIndicator,
  LegacyMeasurement,
  LegacyMembershipRequest,
  LegacyProvider,
  LegacyService,
  LegacyUser,
} from '../src/legacy.ts';
import {
  FILES,
  MANIFEST,
  measurementFile,
  SNAPSHOT_FORMAT,
  type Manifest,
} from '../src/snapshot.ts';

export interface SnapshotParts {
  providers?: LegacyProvider[];
  categories?: string[];
  services?: Partial<LegacyService>[];
  indicatorsByCategory?: Record<string, LegacyIndicator[]>;
  indicatorsByService?: Record<string, LegacyIndicator[]>;
  users?: LegacyUser[];
  membershipRequests?: LegacyMembershipRequest[];
  measurements?: Record<string, LegacyMeasurement[]>;
}

export const service = (
  abbreviation: string,
  overrides: Partial<LegacyService> = {},
): LegacyService => ({
  abbreviation,
  name: abbreviation,
  category: 'Tools',
  provider: 'BioNet',
  license: 'MIT',
  consortia: [],
  stage: 'PROD',
  ...overrides,
});

export async function writeSnapshot(dir: string, parts: SnapshotParts = {}): Promise<Manifest> {
  const files: Manifest['files'] = {};
  const write = async (path: string, data: unknown) => {
    const content = `${JSON.stringify(data, null, 2)}\n`;
    await writePrivateFile(join(dir, path), content);
    files[path] = { sha256: sha256(content), bytes: Buffer.byteLength(content) };
  };
  await write(
    FILES.providers,
    parts.providers ?? [{ abbreviation: 'BioNet', name: 'BioNet Services' }],
  );
  await write(
    FILES.categories,
    (parts.categories ?? ['Tools']).map((name) => ({ name })),
  );
  await write(
    FILES.services,
    (parts.services ?? [service('GeneFlow')]).map((s) => service(s.abbreviation ?? 'GeneFlow', s)),
  );
  await write(FILES.indicatorsByCategory, parts.indicatorsByCategory ?? {});
  await write(FILES.indicatorsByService, parts.indicatorsByService ?? {});
  await write(FILES.users, parts.users ?? []);
  await write(FILES.membershipRequests, parts.membershipRequests ?? []);
  for (const [name, points] of Object.entries(parts.measurements ?? {})) {
    await write(measurementFile(name), points);
  }
  const manifest: Manifest = {
    format: SNAPSHOT_FORMAT,
    source: 'https://legacy.example.org/scorpion',
    fetchedAt: '2026-11-17T10:00:00.000Z',
    files,
  };
  await writePrivateFile(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
