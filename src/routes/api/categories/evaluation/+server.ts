import { category, evaluation, indicator } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	const db_evaluations = await db
		.select()
		.from(evaluation)
		.innerJoin(indicator, eq(evaluation.indicatorId, indicator.id))
		.innerJoin(category, eq(evaluation.categoryId, category.id));

	const response = db_evaluations.map((row) => ({
		category: row.category.name,
		indicator: row.indicator.name,
		aggregate: row.evaluation.aggregate
	}));

	return json(response);
};

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();

	await db.delete(evaluation);

	for (const mapping of data.evaluations) {
		const db_category = await db
			.select()
			.from(category)
			.where(eq(category.name, mapping.category))
			.limit(1);

		if (db_category.length === 0) {
			console.warn(`Category with name ${mapping.category} not found. Skipping evaluation.`);
			return new Response(null, { status: 400 });
		}

		const db_indicator = await db
			.select()
			.from(indicator)
			.where(eq(indicator.name, mapping.indicator))
			.limit(1);

		if (db_indicator.length === 0) {
			console.warn(`Indicator with name ${mapping.indicator} not found. Skipping evaluation.`);
			return new Response(null, { status: 400 });
		}

		await db.insert(evaluation).values({
			categoryId: db_category[0].id,
			indicatorId: db_indicator[0].id,
			aggregate: mapping.aggregate
		});
	}

	return new Response();
};
