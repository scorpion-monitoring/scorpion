import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { serviceForm } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request }) => {
	const data = await request.json();
	let model: any = {
		serviceName: data.serviceName,
		maturityModel: data.modelName,
		additionalInfo: {},
		formData: []
	};
	const additionalInfo: Record<string, string> = {};
	const formData: Record<string, any> = {};
	for (const key of Object.keys(data)) {
		if (data[key] instanceof Object) {
			formData[key] = data[key];
		} else if (typeof data[key] === 'string' && key !== 'serviceName' && key !== 'modelName') {
			additionalInfo[key] = data[key];
		}
	}
	model.formData.push(formData);
	model.additionalInfo = additionalInfo;

	const inserted = await db.insert(serviceForm).values(model).returning();

	return json({});
};
