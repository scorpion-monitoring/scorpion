import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import {
	category,
	categoryToIndicator,
	indicator,
	service,
	serviceToIndicator
} from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	let serviceId = url.searchParams.get('serviceId');

	if (!serviceId) {
		let db_indicators = await db.select().from(indicator).orderBy(indicator.name);

		let indicators: Array<{ name: string }> = db_indicators.map((i) => ({
			name: i.name
		}));

		return json({ indicators });
	} else {
		var db_category_indicators = await db
			.select()
			.from(service)
			.where(eq(service.abbreviation, serviceId))
			.leftJoin(categoryToIndicator, eq(service.category, categoryToIndicator.categoryId))
			.leftJoin(indicator, eq(categoryToIndicator.indicatorId, indicator.id));

		var db_service_indicators = await db
			.select()
			.from(service)
			.where(eq(service.abbreviation, serviceId))
			.leftJoin(serviceToIndicator, eq(service.id, serviceToIndicator.serviceId))
			.leftJoin(indicator, eq(serviceToIndicator.indicatorId, indicator.id));

		let indicators: Array<{ name: string; necessity: string; type: string }> =
			db_category_indicators.map((row) => ({
				name: row.indicator?.name || '',
				necessity: row.category_to_indicator?.necessity || '',
				type: row.indicator?.type || ''
			}));

		if (db_service_indicators.length > 0) {
			for (const row of db_service_indicators) {
				if (row.indicator) {
					indicators.push({
						name: row.indicator.name,
						necessity: 'additional',
						type: row.indicator.type || ''
					});
				}
			}
		}

		return json({ indicators: indicators.sort((a, b) => a.name.localeCompare(b.name)) });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();
	const { name, description, type, indicator_category, categories } = data;

	var db_indicator = await db.select().from(indicator).where(eq(indicator.name, name));

	if (db_indicator.length > 0) {
		return new Response('Indicator already exists', { status: 409 });
	}

	db_indicator = await db
		.insert(indicator)
		.values({
			name,
			description,
			type: type as 'number' | 'float' | 'text',
			category: indicator_category as 'Bibliographic' | 'Usage' | 'Technical' | 'Satisfaction'
		})
		.returning();

	for (const [categoryName, necessity] of Object.entries(categories)) {
		if (
			typeof necessity !== 'string' ||
			!['mandatory', 'recommended', 'optional', ''].includes(necessity)
		) {
			return new Response(`Invalid necessity value for category ${categoryName}`, { status: 400 });
		}

		if (necessity === '') {
			continue; // Skip if no association is needed
		}

		var db_category = await db.select().from(category).where(eq(category.name, categoryName));
		if (db_category.length === 0) {
			return new Response(`Category ${categoryName} not found`, { status: 404 });
		}

		await db.insert(categoryToIndicator).values({
			categoryId: db_category[0].id,
			indicatorId: db_indicator[0].id,
			necessity: necessity as 'mandatory' | 'recommended' | 'optional'
		});
	}

	return json({ message: 'Indicator created successfully' }, { status: 201 });
};
