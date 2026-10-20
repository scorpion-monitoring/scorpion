// For the browser tests only (`apps/web/e2e/reporting-reminder.spec.ts`): runs the body of the reporting reminder once, as a second
// node of the running stack, with the module's clock fixed at `REMINDER_NOW` (an ISO time). The real job fires at 06:00 UTC on the
// setting's day, so a journey cannot wait for it, and the clock is the one input the module lets a caller inject. Everything else is
// the product's own code over the stack's database: the same selection, recipients, sent-table and template. It prints the report
// (counts only) as one JSON line. Not part of the image's commands; nothing imports it.
import { createKernel, createLogger, loadConfig } from '@scorpion/kernel';
import { createKpiIngestionModule, type KpiIngestionService } from '@scorpion/kpi-ingestion/module';
import ingestionPackage from '@scorpion/kpi-ingestion/package.json' with { type: 'json' };
import { moduleIds, profileName, sources } from '../generated/profile.ts';

const now = new Date(process.env.REMINDER_NOW ?? '');
if (Number.isNaN(now.getTime())) throw new Error('REMINDER_NOW must be an ISO time');

const config = loadConfig({ PROFILE: profileName, ...process.env });
const kernel = createKernel({
  profile: { name: profileName, modules: moduleIds },
  sources: sources.map((source) =>
    source.manifest.id === 'kpi.ingestion'
      ? { manifest: createKpiIngestionModule({ clock: () => now }), packageJson: ingestionPackage }
      : source,
  ),
  config,
  log: createLogger({ level: 'warn' }),
});
try {
  await kernel.start();
  const ingestion = kernel.services.get('kpi.ingestion') as KpiIngestionService;
  console.log(JSON.stringify(await ingestion.reminder.run()));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // A second node must never outlive its one run: stop with a bound, then leave whatever the kernel still holds open.
  await Promise.race([
    kernel.stop(10_000),
    new Promise((resolve) => setTimeout(resolve, 15_000)),
  ]).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
