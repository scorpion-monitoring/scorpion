import { defineModule } from '@scorpion/kernel';
import type { IdentityService } from './public.ts';
import { createUserService } from './service/users.ts';

export default defineModule<IdentityService>({
  id: 'core.identity',
  version: '0.1.0',
  // Short on purpose: the module's tables are `identity_user`, not `core_identity_user` (ADR 0004).
  tablePrefix: 'identity_',

  schema: () => import('./db/schema.ts'),
  migrations: new URL('./migrations', import.meta.url),

  services: (ctx) => ({ users: createUserService(ctx) }),
});
