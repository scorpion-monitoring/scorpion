import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load = (async () => {
	return {
		services: await db.select().from(table.service),
		categories: await db.select().from(table.category),
		providers: await db.select().from(table.provider),
		providerToServices: await db.select().from(table.providerToService),
		consortia: await db.select().from(table.consortium),
		consortiumToServices: await db.select().from(table.consortiumToService),
		indicators: await db.select().from(table.indicator),
		serviceToIndicators: await db.select().from(table.serviceToIndicator),
		categoryToIndicators: await db.select().from(table.categoryToIndicator)
	};
}) satisfies PageServerLoad;
