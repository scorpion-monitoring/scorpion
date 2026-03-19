import { db } from '$lib/server/db';
import {
	category,
	categoryToIndicator,
	indicator,
	service,
	serviceToIndicator
} from '$lib/server/db/schema';
import { count, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { Indicator } from '$lib/openapi/schemas';
import { json } from '@sveltejs/kit';
import { DEFAULT_API_PAGE_SIZE } from '$lib/server/constants';

/**
 * @swagger
 * /api/v1/indicators:
 *   get:
 *     summary: Get all indicators
 *     tags:
 *       - V1 Endpoints
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         description: Category abbreviation to filter indicators
 *         schema:
 *           type: string
 *       - in: query
 *         name: service
 *         description: Service abbreviation to filter indicators
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         description: Page number for pagination (default is 0)
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         description: Number of items per page (default is 1000)
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/KPIResponse'
 *
 */
export const GET: RequestHandler = async ({ url }) => {
	const q_category = url.searchParams.get('category')?.split(',');
	const q_service = url.searchParams.get('service');
	const q_page = url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : 0;
	const q_pageSize = url.searchParams.get('pageSize')
		? parseInt(url.searchParams.get('pageSize')!)
		: DEFAULT_API_PAGE_SIZE;

	let indicators: Array<Indicator> = [];

	const indicatorCount = await db.select({ count: count() }).from(indicator);

	const db_indicators = await db
		.select()
		.from(indicator)
		.limit(q_pageSize)
		.offset(q_page * q_pageSize);

	for (const db_indicator of db_indicators) {
		indicators.push({
			name: db_indicator.name,
			description: db_indicator.description,
			selected: false,
			categories: []
		});
	}

	if (q_service) {
		const service_indicators = await db
			.select()
			.from(serviceToIndicator)
			.innerJoin(indicator, eq(serviceToIndicator.indicatorId, indicator.id))
			.innerJoin(service, eq(serviceToIndicator.serviceId, service.id))
			.where(eq(service.abbreviation, q_service));

		for (const service_indicator of service_indicators) {
			const indicatorIndex = indicators.findIndex(
				(ind) => ind.name === service_indicator.indicator.name
			);
			if (indicatorIndex !== -1) {
				indicators[indicatorIndex].selected = true;
			}
		}

		const db_service = await db
			.select()
			.from(service)
			.where(eq(service.abbreviation, q_service))
			.limit(1);

		const service_category = db_service[0].category;

		const service_category_indicators = await db
			.select()
			.from(categoryToIndicator)
			.innerJoin(category, eq(categoryToIndicator.categoryId, category.id))
			.innerJoin(indicator, eq(categoryToIndicator.indicatorId, indicator.id))
			.where(eq(category.id, service_category));

		for (const category_indicator of service_category_indicators) {
			const indicatorIndex = indicators.findIndex(
				(ind) => ind.name === category_indicator.indicator.name
			);
			if (indicatorIndex !== -1) {
				indicators[indicatorIndex].categories.push({
					name: category_indicator.category.name,
					necessity: category_indicator.category_to_indicator.necessity
				});
				indicators[indicatorIndex].selected = true;
			}
		}
	} else {
		if (q_category) {
			const category_indicators = await db
				.select()
				.from(categoryToIndicator)
				.innerJoin(category, eq(categoryToIndicator.categoryId, category.id))
				.innerJoin(indicator, eq(categoryToIndicator.indicatorId, indicator.id))
				.where(inArray(category.name, q_category));

			for (const category_indicator of category_indicators) {
				const indicatorIndex = indicators.findIndex(
					(ind) => ind.name === category_indicator.indicator.name
				);
				if (indicatorIndex !== -1) {
					indicators[indicatorIndex].categories.push({
						name: category_indicator.category.name,
						necessity: category_indicator.category_to_indicator.necessity
					});
					indicators[indicatorIndex].selected = true;
				}
			}
		} else {
			const category_indicators = await db
				.select()
				.from(categoryToIndicator)
				.innerJoin(category, eq(categoryToIndicator.categoryId, category.id))
				.innerJoin(indicator, eq(categoryToIndicator.indicatorId, indicator.id));

			for (const category_indicator of category_indicators) {
				const indicatorIndex = indicators.findIndex(
					(ind) => ind.name === category_indicator.indicator.name
				);
				if (indicatorIndex !== -1) {
					indicators[indicatorIndex].categories.push({
						name: category_indicator.category.name,
						necessity: category_indicator.category_to_indicator.necessity
					});
				}
			}
		}
	}

	// Implement logic to fetch and filter indicators based on the query parameters
	return json({
		metadata: {
			currentPage: q_page,
			pageSize: q_pageSize,
			totalPages: Math.ceil(indicatorCount[0].count / q_pageSize),
			totalCount: indicatorCount[0].count
		},
		result: indicators
	});
};
