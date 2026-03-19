import type { Category, Response } from '$lib/openapi/schemas';
import { db } from '$lib/server/db';
import { category } from '$lib/server/db/schema';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { count } from 'drizzle-orm';
import { DEFAULT_API_PAGE_SIZE } from '$lib/server/constants';

/**
 * @swagger
 * /api/v1/categories:
 *   get:
 *     summary: Get all categories
 *     tags:
 *       - V1 Endpoints
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
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
 *                 $ref: '#/components/schemas/CategoryResponse'
 *
 */
export const GET: RequestHandler = async ({ url }) => {
	const page: number = Number(url.searchParams.get('page') || 0);
	const pageSize: number = Number(url.searchParams.get('pageSize') || DEFAULT_API_PAGE_SIZE);

	const countResult = await db.select({ count: count() }).from(category);
	const totalCount = countResult[0].count;

	const db_categories = await db
		.select()
		.from(category)
		.limit(pageSize)
		.offset(page * pageSize);

	const response: Response<Category> = {
		metadata: {
			currentPage: page,
			pageSize,
			totalCount,
			totalPages: Math.ceil(totalCount / pageSize)
		},
		result: db_categories.map((c) => ({
			name: c.name
		}))
	};

	return json(response);
};
