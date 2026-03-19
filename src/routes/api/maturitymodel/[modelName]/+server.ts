import { maturityModel } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { json } from '@sveltejs/kit';

export const PUT: RequestHandler = async ({ url, request }) => {
	const modelName = url.pathname.split('/').pop()
		? decodeURIComponent(url.pathname.split('/').pop() as string)
		: undefined;
	const data = await request.json();

	if (!modelName) {
		return new Response('Model name is required', { status: 400 });
	}
	// Remove all existing entries for the model
	await db.delete(maturityModel).where(eq(maturityModel.name, modelName));

	// Insert new entries

	const inserted = [];
	for (const entry of data) {
		const result = await db
			.insert(maturityModel)
			.values({
				name: modelName,
				levels: entry.levels,
				topic: entry.topic,
				domain: entry.domain
			})
			.returning();
		inserted.push(result);
	}

	const response = inserted.map((i) => i[0]);

	return json({ data: response });
};
