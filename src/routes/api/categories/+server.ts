import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { category, categoryToIndicator, indicator } from '$lib/server/db/schema';
import type { Category } from '$lib/openapi/schemas';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	var db_categories = await db.select().from(category);

	var category_indicators = await db
		.select({
			categoryId: categoryToIndicator.categoryId,
			necessity: categoryToIndicator.necessity,
			indicatorId: indicator.id,
			indicatorName: indicator.name
		})
		.from(categoryToIndicator)
		.innerJoin(indicator, eq(categoryToIndicator.indicatorId, indicator.id));

	const categoryIndicatorsMap: Map<number, { id: number; name: string; necessity: string }[]> =
		new Map();
	for (const ci of category_indicators) {
		if (!categoryIndicatorsMap.has(ci.categoryId)) {
			categoryIndicatorsMap.set(ci.categoryId, []);
		}
		categoryIndicatorsMap
			.get(ci.categoryId)!
			.push({ id: ci.indicatorId, name: ci.indicatorName, necessity: ci.necessity });
	}

	var categories: Array<Category> = db_categories.map((c) => ({
		name: c.name,
		indicators: categoryIndicatorsMap.get(c.id) || []
	}));

	return json({ categories });
};

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();
	const name: string = data.name;
	const indicators: Record<string, string> = data.indicators || {};

	const existingCategory = await db.select().from(category).where(eq(category.name, name)).limit(1);

	if (existingCategory.length > 0) {
		return json({ error: 'Category already exists' }, { status: 400 });
	}

	var newCategoryId = await db.insert(category).values({ name }).returning({ id: category.id });

	if (Object.keys(indicators).length > 0) {
		const entries = Object.entries(indicators);
		const categoryIndicatorInserts = await Promise.all(
			entries.map(async ([indicatorName, necessity]) => {
				const rows = await db
					.select()
					.from(indicator)
					.where(eq(indicator.name, indicatorName))
					.limit(1);
				const ind = rows[0] || null;
				return {
					categoryId: newCategoryId[0].id,
					indicator: ind,
					necessity
				};
			})
		);

		for (const ci of categoryIndicatorInserts) {
			if (ci.indicator === null) continue;
			if (
				ci.necessity !== 'mandatory' &&
				ci.necessity !== 'recommended' &&
				ci.necessity !== 'optional'
			)
				continue;
			await db.insert(categoryToIndicator).values({
				categoryId: ci.categoryId as number,
				indicatorId: ci.indicator.id as number,
				necessity: ci.necessity as 'mandatory' | 'recommended' | 'optional'
			});
		}
	}

	return json({ message: 'Category created successfully' }, { status: 201 });
};
