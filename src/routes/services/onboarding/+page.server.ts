import { db } from '$lib/server/db';
import { maturityModel, settings } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load = (async () => {
	const rules = await db.select().from(maturityModel);

	const models: Array<any> = [];
	for (const rule of rules) {
		if (!models.find((model) => model.name === rule.name)) {
			models.push({
				name: rule.name,
				domains: [
					{
						name: rule.domain,
						topics: [
							{
								name: rule.topic,
								levels: rule.levels
							}
						]
					}
				]
			});
		} else {
			const model = models.find((model) => model.name === rule.name);
			if (model) {
				const domain = model.domains.find(
					(domain: { name: string }) => domain.name === rule.domain
				);
				if (domain) {
					domain.topics.push({
						name: rule.topic,
						levels: rule.levels
					});
				} else {
					model.domains.push({
						name: rule.domain,
						topics: [
							{
								name: rule.topic,
								levels: rule.levels
							}
						]
					});
				}
			}
		}
	}
	return {
		models,
		settings:
			(await db.select().from(settings).where(eq(settings.key, 'maturityModel'))).map(
				(setting) => setting.value
			) || []
	};
}) satisfies PageServerLoad;
