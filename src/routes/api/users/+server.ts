import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
export const GET: RequestHandler = async ({ url }) =>{
    console.log('Request URL:', url.href);
  const users = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ];
  return json({ users });
}