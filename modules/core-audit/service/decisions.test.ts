// Plan risk table: "a test fails when a declared event has no audit decision (logged or explicitly
// skipped)". It reads the events of the modules this one depends on from a real composition, so a new
// event in any of them fails here until somebody decides.
import { describe, expect, it } from 'vitest';
import { EVENT_DECISIONS } from './decisions.ts';
import { useAudit } from '../test/harness.ts';

const audit = useAudit();

describe('the audit decision for every declared event', () => {
  it('has one for every event of the loaded modules, and none for an event that does not exist', async () => {
    const s = await audit.startShared();
    const declared = [...s.kernel.composition.events.values()].map((event) => event.name).sort();
    expect(declared.length).toBeGreaterThan(20);
    const undecided = declared.filter((name) => !(name in EVENT_DECISIONS));
    expect(
      undecided,
      `declared events with no audit decision: add each to EVENT_DECISIONS in core-audit/service/decisions.ts as logged, or skipped with a reason: ${undecided.join(', ')}`,
    ).toEqual([]);
    const stale = Object.keys(EVENT_DECISIONS).filter((name) => !declared.includes(name));
    expect(stale, `decisions for events no loaded module declares: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('gives every skipped event a reason that says something, and subscribes to every logged one', async () => {
    const s = await audit.startShared();
    for (const [name, decision] of Object.entries(EVENT_DECISIONS)) {
      if (decision.decision === 'skip') expect(decision.reason.length, name).toBeGreaterThan(30);
    }
    const subscribed = new Set(Object.keys(s.manifest.events?.on ?? {}));
    for (const [name, decision] of Object.entries(EVENT_DECISIONS)) {
      expect(subscribed.has(name), name).toBe(decision.decision === 'log');
    }
  });

  it('marks as critical the events of role, approval, token, settings and secret changes', () => {
    const critical = Object.entries(EVENT_DECISIONS)
      .filter(([, d]) => d.decision === 'log' && d.critical)
      .map(([name]) => name);
    for (const name of [
      'authz.role.assigned@1',
      'authz.role.removed@1',
      'authz.role.permissions.changed@1',
      'identity.user.approved@1',
      'identity.user.rejected@1',
      'identity.user.deactivated@1',
      'identity.token.created@1',
      'identity.token.revoked@1',
      'identity.token.rotated@1',
      'settings.changed@1',
      'settings.secret.changed@1',
    ]) {
      expect(critical, name).toContain(name);
    }
  });
});

describe('no declared event schema carries a secret', () => {
  const SECRET_WORDS =
    /(password|passwd|secret|token(?!id)|apikey|api_key|authorization|credential|hash|salt|private|cookie|session(?!id))/i;
  // A field that only names or points at a secret is allowed: `settings.secret.changed@1` has `name`.
  const ALLOWED = new Set(['tokenId', 'previousTokenId']);

  it('has no field named like a password, token, secret, key or credential', async () => {
    const s = await audit.startShared();
    const offenders: string[] = [];
    for (const event of s.kernel.composition.events.values()) {
      const shape = (event.schema as unknown as { shape?: Record<string, unknown> }).shape;
      expect(shape, `${event.name} is not an object schema`).toBeDefined();
      for (const field of Object.keys(shape!)) {
        if (!ALLOWED.has(field) && SECRET_WORDS.test(field))
          offenders.push(`${event.name}.${field}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is strict: an event schema refuses a field it does not declare, so a secret cannot ride along', async () => {
    const s = await audit.startShared();
    for (const event of s.kernel.composition.events.values()) {
      const def = (event.schema as unknown as { def: { catchall?: { def: { type: string } } } })
        .def;
      expect(def.catchall?.def.type, `${event.name} lets unknown fields through`).toBe('never');
    }
  });
});
