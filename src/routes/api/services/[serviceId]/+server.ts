import {
	service,
	category,
	consortium,
	consortiumToService,
	providerToService,
	provider,
	serviceToIndicator,
	indicator
} from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	let serviceId = url.pathname.split('/').pop();

	var db_services = await db
		.select()
		.from(service)
		.leftJoin(category, eq(service.category, category.id))
		.where(eq(service.abbreviation, serviceId!))
		.limit(1);

	var db_providers = await db
		.select()
		.from(provider)
		.leftJoin(providerToService, eq(provider.id, providerToService.providerId))
		.leftJoin(service, eq(providerToService.serviceId, service.id));

	// Map providers to services
	var provider_map: Record<number, string> = {};
	for (const row of db_providers) {
		if (row.service) {
			provider_map[row.service.id] = row.provider.abbreviation;
		}
	}

	var db_consortia = await db
		.select()
		.from(consortium)
		.leftJoin(consortiumToService, eq(consortium.id, consortiumToService.consortiumId))
		.leftJoin(service, eq(consortiumToService.serviceId, service.id));

	// Map consortia to services
	var consortia_map: Record<number, string[]> = {};
	for (const row of db_consortia) {
		if (row.service) {
			if (!consortia_map[row.service.id]) {
				consortia_map[row.service.id] = [];
			}
			consortia_map[row.service.id].push(row.consortium.name);
		}
	}

	const services = db_services.map((row) => ({
		abbreviation: row.service.abbreviation,
		name: row.service.name,
		provider: provider_map[row.service.id] || '',
		category: row.category?.name || '',
		consortia: consortia_map[row.service.id] || [],
		stage: row.service.stage,
		icon: row.service.icon
	}));

	return json({ service: services[0] });
};

export const PUT: RequestHandler = async ({ request, url }) => {
	let serviceId = url.pathname.split('/').pop();
	const data = await request.json();

	var db_service = (
		await db.select().from(service).where(eq(service.abbreviation, serviceId!)).limit(1)
	)[0];

	var db_category = (
		await db.select().from(category).where(eq(category.name, data.service.category)).limit(1)
	)[0];

	await db
		.update(service)
		.set({
			abbreviation: data.service.abbreviation,
			name: data.service.name,
			stage: data.service.stage,
			category: db_category.id,
			icon: data.service.icon ?? ''
		})
		.where(eq(service.id, db_service.id));

	if (db_service.category !== db_category.id) {
		await db.delete(serviceToIndicator).where(eq(serviceToIndicator.serviceId, db_service.id));
	}

	var service_indicators = data.indicators.filter(
		(indicator: { necessity: string }) => indicator.necessity === 'additional'
	);

	var service_indicator_names = service_indicators.map(
		(indicator: { name: string }) => indicator.name
	);

	var db_indicators = await db
		.selectDistinct()
		.from(indicator)
		.innerJoin(service, inArray(indicator.name, service_indicator_names))
		.where(eq(service.abbreviation, data.service.abbreviation));

	for (const indicator of service_indicators) {
		const db_indicator = db_indicators.find(
			(db_indicator) => db_indicator.indicator.name === indicator.name
		);
		if (!db_indicator) continue;

		const indicatorId = db_indicator.indicator.id;

		const existing = await db
			.select()
			.from(serviceToIndicator)
			.where(
				and(
					eq(serviceToIndicator.serviceId, db_service.id),
					eq(serviceToIndicator.indicatorId, indicatorId)
				)
			)
			.limit(1);

		if (existing.length === 0) {
			await db.insert(serviceToIndicator).values({
				serviceId: db_service.id,
				indicatorId
			});
		}
	}

	var db_provider = (
		await db
			.select()
			.from(provider)
			.where(eq(provider.abbreviation, data.service.provider))
			.limit(1)
	)[0];

	await db.delete(providerToService).where(eq(providerToService.serviceId, db_service.id));

	await db.insert(providerToService).values({
		serviceId: db_service.id,
		providerId: db_provider.id
	});

	// update the consortia associations
	await db.delete(consortiumToService).where(eq(consortiumToService.serviceId, db_service.id));

	for (const consortiumName of data.service.consortia) {
		var db_consortium = (
			await db.select().from(consortium).where(eq(consortium.name, consortiumName)).limit(1)
		)[0];

		if (db_consortium) {
			await db.insert(consortiumToService).values({
				serviceId: db_service.id,
				consortiumId: db_consortium.id
			});
		}
	}

	return json({ message: 'Service updated successfully' });
};
