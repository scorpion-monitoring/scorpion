// The journey specs (`e2e/journeys/jNN-<slug>.spec.ts`) are what the knowledge base mirrors step by step, and the docs export lists their steps.
// This test fails for a spec in that folder that is not named jNN-<slug>, has no `test.step`, or has a step title that is not a short imperative
// sentence; and for a journey that is missing from the list below (J11 is API-only, J13 to J18 need modules that are not released).
import { resolve } from 'node:path';
import { readJourneys } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';

const journeys = readJourneys(resolve(import.meta.dirname, '../e2e/journeys'));

describe('the journey specs', () => {
  it('are exactly the journeys that have a browser spec today', () => {
    expect(journeys.map((journey) => `${journey.id}-${journey.slug}`)).toEqual([
      'j01-register-and-get-approved',
      'j02-sign-in-with-oidc',
      'j03-set-up-profile',
      'j04-personal-access-token',
      'j05-request-membership',
      'j06-create-service',
      'j07-edit-service',
      'j08-find-services',
      'j09-submit-kpi-values-form',
      'j10-import-kpi-values-file',
      'j12-read-dashboard-and-export',
    ]);
  });

  it.each(journeys.map((journey) => [journey.file, journey] as const))(
    '%s is a journey with steps in the right form',
    (_file, journey) => {
      expect(journey.problems).toEqual([]);
      expect(journey.tests).toBeGreaterThan(0);
      expect(journey.steps.length).toBeGreaterThanOrEqual(journey.tests);
    },
  );
});
