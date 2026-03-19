import { db } from '$lib/server/db';
import { provider, userToProvider } from '$lib/server/db/schema';
import { and, count, eq, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import type { Provider, Response } from '$lib/openapi/schemas';
import { DEFAULT_API_PAGE_SIZE } from '$lib/server/constants';

/**
 * @swagger
 * /api/v1/providers:
 *   get:
 *     summary: Get all providers
 *     tags:
 *       - V1 Endpoints
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: is_member
 *         description: Filter providers by membership status
 *         schema:
 *           type: boolean
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
 *                 $ref: '#/components/schemas/ProviderResponse'
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = (locals as any).userId;
	const isMemberParam = url.searchParams.get('is_member');
	const isMember = isMemberParam ? isMemberParam === 'true' : undefined;
	const page = url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : 0;
	const pageSize = url.searchParams.get('pageSize')
		? parseInt(url.searchParams.get('pageSize')!)
		: DEFAULT_API_PAGE_SIZE;

	let providers = [];
	let totalCount = 0;
	if (isMember === undefined) {
		const countResult = await db.select({ count: count() }).from(provider);
		totalCount = countResult[0].count;

		const db_providers = await db
			.select()
			.from(provider)
			.limit(pageSize)
			.offset(page * pageSize);

		providers = db_providers.map((p) => ({
			abbreviation: p.abbreviation,
			name: p.name
		}));
	} else {
		const countResult = await db
			.select({ count: count() })
			.from(provider)
			.leftJoin(userToProvider, eq(provider.id, userToProvider.providerId))
			.where(
				and(
					isMember ? eq(userToProvider.userId, userId) : ne(userToProvider.userId, userId),
					isMember ? eq(userToProvider.approved, true) : undefined
				)
			);
		totalCount = countResult[0].count;

		// FIXME: isMember = false is not working as expected
		const db_providers = await db
			.select()
			.from(provider)
			.leftJoin(userToProvider, eq(provider.id, userToProvider.providerId))
			.where(
				and(
					isMember ? eq(userToProvider.userId, userId) : ne(userToProvider.userId, userId),
					isMember ? eq(userToProvider.approved, true) : undefined
				)
			)
			.limit(pageSize)
			.offset(page * pageSize);

		providers = db_providers.map((p) => ({
			abbreviation: p.provider.abbreviation,
			name: p.provider.name
		}));
	}

	const response: Response<Provider> = {
		metadata: {
			totalCount,
			totalPages: Math.ceil(totalCount / pageSize),
			pageSize,
			currentPage: page
		},
		result: providers
	};

	return json(response);
};
