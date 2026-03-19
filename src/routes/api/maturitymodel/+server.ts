import { db } from '$lib/server/db';
import { maturityModel } from '$lib/server/db/schema';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const modelName = url.searchParams.get('model');
	const dbMaturityModel = await db
		.select()
		.from(maturityModel)
		.where(modelName ? eq(maturityModel.name, modelName) : undefined);

	return json(dbMaturityModel);
};
