<script lang="ts">
  import { z } from '@scorpion/contracts';
  import { ApiError } from '@scorpion/contracts/client';
  import { failureOf, SchemaForm, type FormFailure } from '@scorpion/ui-kit';
  import LogoWidget from './LogoWidget.svelte';

  // A settings-like schema with every kind of field the form draws.
  const schema = z.toJSONSchema(
    z.strictObject({
      enabled: z
        .boolean()
        .default(true)
        .meta({ title: 'Enabled', description: 'Turns the feature on.' }),
      name: z.string().min(1).max(40).meta({ title: 'Name', description: 'What people see.' }),
      note: z.string().max(5000).optional().meta({ title: 'Note' }),
      contact: z.email().optional().meta({ title: 'Contact address' }),
      port: z.number().int().min(1).max(65535).default(25).meta({ title: 'Port', group: 'Server' }),
      mode: z
        .enum(['plain', 'tls', 'starttls'])
        .default('plain')
        .meta({ title: 'Mode', group: 'Server' }),
      token: z
        .string()
        .optional()
        .meta({ title: 'Access token', writeOnly: true, group: 'Server' }),
      tags: z.array(z.string()).max(4).default([]).meta({ title: 'Tags' }),
      limits: z
        .strictObject({
          burst: z.int().min(1).default(10),
          perMinute: z.number().min(1).default(60),
        })
        .default({ burst: 10, perMinute: 60 })
        .meta({ title: 'Limits' }),
      providers: z
        .array(z.strictObject({ id: z.string().min(1), label: z.string().optional() }))
        .max(4)
        .default([])
        .meta({ title: 'Providers' }),
      transport: z
        .discriminatedUnion('type', [
          z.strictObject({ type: z.literal('smtp'), host: z.string().meta({ title: 'Host' }) }),
          z.strictObject({ type: z.literal('none') }),
        ])
        .meta({ title: 'Transport' })
        .optional(),
      logo: z.string().optional().meta({ title: 'Logo', widget: 'logo' }),
    }),
    { io: 'input', unrepresentable: 'any' },
  );

  const stored = {
    enabled: true,
    name: 'Scorpion',
    port: 25,
    mode: 'plain',
    tags: ['one'],
    limits: { burst: 10, perMinute: 60 },
    providers: [{ id: 'a', label: 'First' }, { id: 'b' }],
  };

  let value = $state<unknown>(stored);
  let failure = $state<FormFailure>();
  let conflict = $state(false);
  let submitted = $state('');
  let count = $state(0);

  function onsubmit(values: unknown) {
    count += 1;
    submitted = JSON.stringify(values);
    failure = undefined;
  }
  // The server's answers, as `failureOf` reads them.
  const problem = (errors: { path: string; message: string }[]) =>
    failureOf(
      new ApiError(422, {
        type: 'about:blank',
        title: 'Unprocessable',
        status: 422,
        detail: 'The request is not valid.',
        errors: errors.map((error) => ({ in: 'body', ...error })),
      }),
    );
</script>

<h1 class="mb-4 text-2xl font-bold">Schema form</h1>
<SchemaForm
  {schema}
  {value}
  {failure}
  errorPrefix="values"
  {conflict}
  onreload={() => {
    conflict = false;
    value = { ...stored, name: 'Reloaded' };
  }}
  widgets={{ logo: LogoWidget }}
  {onsubmit}
/>

<div class="mt-6 flex flex-wrap gap-2">
  <button
    type="button"
    class="btn btn-sm"
    onclick={() =>
      (failure = problem([
        { path: 'values.name', message: 'Name is already used.' },
        { path: 'values.limits.burst', message: 'Burst is too small.' },
        { path: 'values.providers.1.id', message: 'Provider id is taken.' },
        { path: 'values.tags', message: 'Too many tags.' },
      ]))}
  >
    Simulate errors
  </button>
  <button type="button" class="btn btn-sm" onclick={() => (conflict = true)}
    >Simulate conflict</button
  >
</div>
<p class="mt-4">Submitted <span data-testid="count">{count}</span> times.</p>
<pre class="bg-base-200 mt-2 overflow-x-auto p-2 text-xs" data-testid="submitted">{submitted}</pre>
