import { db } from '$lib/server/db';
import { category, categoryToIndicator, indicator } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import type { Category } from '$lib/openapi/schemas';

export const GET: RequestHandler = async ({ url }) => {
	const categoryName = url.pathname.split('/').at(-1);
	var db_categories = await db.select().from(category).where(eq(category.name, categoryName!));

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

	return json({ category: categories[0] });
};

export const PUT: RequestHandler = async ({ request, url }) => {
	const categoryName = url.pathname.split('/').at(-1);
	const data = await request.json();
	const { indicators } = data;

	var db_category = await db.select().from(category).where(eq(category.name, categoryName!));

	if (db_category.length === 0) {
		return new Response('Category not found', { status: 404 });
	}

	for (const [i, n] of Object.entries(indicators)) {
		// Check if necessity is valid
		if (typeof n !== 'string' || !['mandatory', 'recommended', 'optional', ''].includes(n)) {
			return new Response(`Invalid necessity value for indicator ${i}`, { status: 400 });
		}

		var db_indicator = await db.select().from(indicator).where(eq(indicator.name, i));

		if (db_indicator.length === 0) {
			return new Response(`Indicator ${i} not found`, { status: 404 });
		}

		var db_category_indicator = await db
			.select()
			.from(categoryToIndicator)
			.where(
				and(
					eq(categoryToIndicator.categoryId, db_category[0].id),
					eq(categoryToIndicator.indicatorId, db_indicator[0].id)
				)
			);

		if (db_category_indicator.length === 0) {
			// Insert new association
			await db.insert(categoryToIndicator).values({
				categoryId: db_category[0].id,
				indicatorId: db_indicator[0].id,
				necessity: n as 'mandatory' | 'recommended' | 'optional'
			});
		} else {
			if (n === '') {
				// Delete association
				await db
					.delete(categoryToIndicator)
					.where(
						and(
							eq(categoryToIndicator.categoryId, db_category[0].id),
							eq(categoryToIndicator.indicatorId, db_indicator[0].id)
						)
					);
				continue;
			} else {
				// Update existing association
				await db
					.update(categoryToIndicator)
					.set({
						necessity: n as 'mandatory' | 'recommended' | 'optional'
					})
					.where(
						and(
							eq(categoryToIndicator.categoryId, db_category[0].id),
							eq(categoryToIndicator.indicatorId, db_indicator[0].id)
						)
					);
			}
		}
	}

	return json({ message: 'Category indicators updated successfully' });
};
