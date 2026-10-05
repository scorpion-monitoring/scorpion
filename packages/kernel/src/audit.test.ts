// The audit sink port (ADR 0021): a kernel registry like the authoriser's, a no-op without an entry.
import { describe, expect, it } from 'vitest';
import { useKernels } from '../test/helpers.ts';
import { buildComposition } from './composition.ts';
import { routeAudit, type AuditEntry } from './audit.ts';
import { KernelStartupError } from './errors.ts';
import { defineModule, type ModuleManifest } from './manifest.ts';
import type { ModuleContext } from './context.ts';
import { resolveProfile } from './resolve.ts';

const kernels = useKernels();

const entry: AuditEntry = { action: 'thing.done', outcome: 'ok', actor: { kind: 'system' } };

/** A module that exposes its `ctx.audit`. */
function caller(id: string, contributes?: ModuleManifest['contributes']) {
  return defineModule<{ audit: ModuleContext['audit'] }>({
    id,
    version: '1.0.0',
    contributes,
    services: (ctx) => ({ audit: ctx.audit }),
  });
}

describe('kernel.auditSink', () => {
  it('is a no-op without a contributing module: kernel.audit and ctx.audit resolve', async () => {
    const kernel = await kernels.inline([caller('plain')]);
    await kernel.start();
    await expect(kernel.audit(entry)).resolves.toBeUndefined();
    const service = kernel.services.get('plain') as { audit: ModuleContext['audit'] };
    await expect(service.audit(entry)).resolves.toBeUndefined();
  });

  it('hands ctx.audit and kernel.audit to the one contributed sink', async () => {
    const seen: AuditEntry[] = [];
    const kernel = await kernels.inline([
      caller('with.sink', {
        'kernel.auditSink': [
          {
            record: (e: AuditEntry) => {
              seen.push(e);
              return Promise.resolve();
            },
          },
        ],
      }),
    ]);
    await kernel.start();
    await kernel.audit(entry);
    await (kernel.services.get('with.sink') as { audit: ModuleContext['audit'] }).audit({
      ...entry,
      action: 'thing.other',
    });
    expect(seen.map((e) => e.action)).toEqual(['thing.done', 'thing.other']);
  });

  it('lets a sink failure reach the caller of ctx.audit (the pipeline catches it, a service does not)', async () => {
    const kernel = await kernels.inline([
      caller('failing', {
        'kernel.auditSink': [{ record: () => Promise.reject(new Error('full')) }],
      }),
    ]);
    await kernel.start();
    await expect(kernel.audit(entry)).rejects.toThrow('full');
  });

  it('refuses a profile where two modules contribute a sink', () => {
    const sink = { 'kernel.auditSink': [{ record: () => Promise.resolve() }] };
    const profile = { name: 'two', modules: ['one', 'two'] as never };
    const build = () =>
      buildComposition(
        resolveProfile({
          profile,
          sources: [caller('one', sink), caller('two', sink)].map((manifest) => ({
            manifest,
            packageJson: { name: `@scorpion/${manifest.id}` },
          })),
          modulePackages: { one: '@scorpion/one', two: '@scorpion/two' },
        }),
      );
    expect(build).toThrow(KernelStartupError);
    expect(build).toThrow(/more than one module contributes to "kernel.auditSink"/);
  });

  it('refuses an entry that is not a function', () => {
    const profile = { name: 'bad', modules: ['bad'] as never };
    expect(() =>
      buildComposition(
        resolveProfile({
          profile,
          sources: [
            {
              manifest: caller('bad', { 'kernel.auditSink': [{ record: 'nope' }] }),
              packageJson: { name: '@scorpion/bad' },
            },
          ],
          modulePackages: { bad: '@scorpion/bad' },
        }),
      ),
    ).toThrow(/registry "kernel.auditSink" entry/);
  });
});

describe('routeAudit', () => {
  it.each([
    [undefined, undefined],
    [false, undefined],
    [true, { body: false, redact: [] }],
    [{}, { body: false, redact: [] }],
    [{ body: true }, { body: true, redact: [] }],
    [
      { body: false, redact: ['iban'] },
      { body: false, redact: ['iban'] },
    ],
    [
      { body: true, redact: ['a', 'b'] },
      { body: true, redact: ['a', 'b'] },
    ],
  ])('%j', (input, expected) => {
    expect(routeAudit(input)).toEqual(expected);
  });
});
