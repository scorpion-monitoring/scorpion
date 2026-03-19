import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ params }) => {
	const userId = params.userId;

	let userSettings = await db.select().from(settings).where(eq(settings.key, userId));
	if (userSettings.length === 0) {
		await db.insert(settings).values({
			key: userId,
			value: JSON.stringify({ service: '', duration: '', filter: '' })
		});
		userSettings = await db.select().from(settings).where(eq(settings.key, userId));
	}

	return json(userSettings[0].value as any);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const userId = params.userId;
	const body = await request.json();

	await db
		.update(settings)
		.set({
			value: JSON.stringify(body)
		})
		.where(eq(settings.key, userId));

	return new Response();
};
