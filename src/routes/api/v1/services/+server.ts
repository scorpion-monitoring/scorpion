import { db } from '$lib/server/db';
import { category, provider, providerToService, service } from '$lib/server/db/schema';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { Response, Service } from '$lib/openapi/schemas';
import { json } from '@sveltejs/kit';
import { DEFAULT_API_PAGE_SIZE } from '$lib/server/constants';

/**
 * @swagger
 * /api/v1/services:
 *   get:
 *     summary: Get all services
 *     tags:
 *       - V1 Endpoints
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: service
 *         description: Service abbreviation for filtering
 *         schema:
 *           type: string
 *       - in: query
 *         name: provider
 *         description: Provider abbreviation for filtering
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
 *                 $ref: '#/components/schemas/ServiceResponse'
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const q_service = url.searchParams.get('service')?.split(',');
	const q_provider = url.searchParams.get('provider')?.split(',');
	const q_page = url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : 0;
	const q_pageSize = url.searchParams.get('pageSize')
		? parseInt(url.searchParams.get('pageSize')!)
		: DEFAULT_API_PAGE_SIZE;

	const totalCount = await db
		.select({ count: count() })
		.from(service)
		.innerJoin(providerToService, eq(service.id, providerToService.serviceId))
		.innerJoin(provider, eq(providerToService.providerId, provider.id))
		.where(
			and(
				q_service ? inArray(service.abbreviation, q_service) : undefined,
				q_provider ? inArray(provider.abbreviation, q_provider) : undefined
			)
		);

	const db_services = await db
		.select()
		.from(service)
		.innerJoin(providerToService, eq(service.id, providerToService.serviceId))
		.innerJoin(provider, eq(providerToService.providerId, provider.id))
		.innerJoin(category, eq(service.category, category.id))
		.where(
			and(
				q_service ? inArray(service.abbreviation, q_service) : undefined,
				q_provider ? inArray(provider.abbreviation, q_provider) : undefined
			)
		)
		.limit(q_pageSize)
		.offset(q_page * q_pageSize);

	const response: Response<Service> = {
		metadata: {
			currentPage: q_page,
			pageSize: q_pageSize,
			totalCount: totalCount[0].count,
			totalPages: Math.ceil(totalCount[0].count / q_pageSize)
		},
		result: db_services.map((db_service) => ({
			name: db_service.service.name,
			abbreviation: db_service.service.abbreviation,
			category: db_service.category.name,
			provider: db_service.provider.abbreviation,
			license: db_service.service.license ?? '',
			stage: db_service.service.stage ?? '',
			consortia: []
		}))
	};

	return json(response);
};
