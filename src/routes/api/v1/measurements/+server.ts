import { db } from '$lib/server/db';
import {
	categoryToIndicator,
	indicator,
	measurements,
	service,
	serviceToIndicator
} from '$lib/server/db/schema';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { DEFAULT_API_PAGE_SIZE } from '$lib/server/constants';

/**
 * @swagger
 * /api/v1/measurements:
 *   get:
 *     summary: Get all measurements
 *     tags:
 *       - V1 Endpoints
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: service
 *         required: true
 *         description: Service abbreviation to filter measurements
 *         schema:
 *           type: string
 *       - in: query
 *         name: indicators
 *         description: Indicators abbreviation to filter measurements
 *         schema:
 *           type: string
 *       - in: query
 *         name: start
 *         description: Start date to filter measurements
 *         schema:
 *           type: string
 *           format: datetime
 *       - in: query
 *         name: stop
 *         description: Stop date to filter measurements
 *         schema:
 *           type: string
 *           format: datetime
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
 *                 $ref: '#/components/schemas/MeasurementResponse'
 *   post:
 *     summary: Create a new measurement
 *     tags:
 *       - V1 Endpoints
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: service
 *         required: true
 *         description: Service abbreviation to associate with the measurement
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/Measurement'
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Measurement'
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const q_service = url.searchParams.get('service');
	const q_indicators = url.searchParams.get('indicators')?.split(',') || null;
	const q_start = url.searchParams.get('start') ? new Date(url.searchParams.get('start')!) : null;
	const q_stop = url.searchParams.get('stop') ? new Date(url.searchParams.get('stop')!) : null;
	const q_page = url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : 0;
	const q_pageSize = url.searchParams.get('pageSize')
		? parseInt(url.searchParams.get('pageSize')!)
		: DEFAULT_API_PAGE_SIZE;

	const totalCount = await db
		.select()
		.from(measurements)
		.innerJoin(service, eq(measurements.serviceId, service.id))
		.innerJoin(indicator, eq(measurements.indicatorId, indicator.id))
		.where(
			and(
				eq(service.abbreviation, q_service!),
				q_indicators ? inArray(indicator.name, q_indicators) : undefined,
				q_start ? gte(measurements.date, q_start.toISOString()) : undefined,
				q_stop ? lte(measurements.date, q_stop.toISOString()) : undefined
			)
		);

	const db_measurements = await db
		.select()
		.from(measurements)
		.innerJoin(service, eq(measurements.serviceId, service.id))
		.innerJoin(indicator, eq(measurements.indicatorId, indicator.id))
		.where(
			and(
				eq(service.abbreviation, q_service!),
				q_indicators ? inArray(indicator.name, q_indicators) : undefined,
				q_start ? gte(measurements.date, q_start.toISOString()) : undefined,
				q_stop ? lte(measurements.date, q_stop.toISOString()) : undefined
			)
		)
		.limit(q_pageSize)
		.offset(q_page * q_pageSize);

	return json({
		metadata: {
			currentPage: q_page,
			pageSize: q_pageSize,
			totalPages: Math.ceil(totalCount.length / q_pageSize),
			totalCount: totalCount.length
		},
		data: db_measurements
			.sort((a, b) => {
				const dateCompare =
					new Date(b.measurements.date).getTime() - new Date(a.measurements.date).getTime();
				if (dateCompare !== 0) return dateCompare;
				return a.indicator.name.localeCompare(b.indicator.name);
			})
			.map((m) => ({
				kpi: m.indicator.name,
				value: m.measurements.value,
				date: m.measurements.date
			}))
	});
};

export const POST: RequestHandler = async ({ request, url }) => {
	const q_service = url.searchParams.get('service');
	const body_measurements = await request.json();

	let indicators: Array<{ name: string; necessity: string; id: number; type: string }> = [];

	const db_service = await db
		.select()
		.from(service)
		.where(eq(service.abbreviation, q_service!))
		.limit(1);

	if (db_service.length === 0) {
		return new Response('Service not found', { status: 404 });
	}

	const service_indicators = await db
		.select()
		.from(serviceToIndicator)
		.innerJoin(indicator, eq(serviceToIndicator.indicatorId, indicator.id))
		.where(eq(serviceToIndicator.serviceId, db_service[0].id));

	for (const si of service_indicators) {
		indicators.push({
			name: si.indicator.name,
			necessity: 'optional',
			id: si.indicator.id,
			type: si.indicator.type!
		});
	}

	const category_indicators = await db
		.select()
		.from(categoryToIndicator)
		.innerJoin(indicator, eq(categoryToIndicator.indicatorId, indicator.id))
		.where(eq(categoryToIndicator.categoryId, db_service[0].category));

	for (const ci of category_indicators) {
		if (!indicators.some((i) => i.id === ci.indicator.id)) {
			indicators.push({
				name: ci.indicator.name,
				necessity: ci.category_to_indicator.necessity,
				id: ci.indicator.id,
				type: ci.indicator.type!
			});
		}
	}

	let inserted: Array<{ kpi: string; date: string; value: string }> = [];

	for (const m of body_measurements) {
		const db_indicator = indicators.find((i) => i.name === m.kpi);
		if (!db_indicator) {
			continue;
		}

		if (db_indicator.type === 'number' && isNaN(m.value)) {
			continue;
		}
		if (db_indicator.type === 'float' && isNaN(m.value)) {
			continue;
		}
		if (db_indicator.type === 'text' && typeof m.value !== 'string') {
			continue;
		}

		let date = new Date(m.date);
		if (date.getDate() === 1 && m.date.length === 7) {
			date = new Date(date.getFullYear(), date.getMonth() + 1, 0);
		}

		const existing_measurement = await db
			.select()
			.from(measurements)
			.where(
				and(
					eq(measurements.serviceId, db_service[0].id),
					eq(measurements.indicatorId, db_indicator.id),
					eq(measurements.date, date.toISOString())
				)
			)
			.limit(1);

		if (existing_measurement.length > 0) {
			await db
				.update(measurements)
				.set({ value: m.value })
				.where(eq(measurements.id, existing_measurement[0].id));

			inserted.push({
				kpi: db_indicator.name,
				date: date.toISOString(),
				value: m.value
			});
			continue;
		}

		const result = await db
			.insert(measurements)
			.values({
				serviceId: db_service[0].id,
				indicatorId: db_indicator.id,
				value: m.value,
				date: date.toISOString()
			})
			.returning();

		inserted.push({
			kpi: db_indicator.name,
			date: result[0].date,
			value: result[0].value
		});
	}

	return json(inserted);
};
