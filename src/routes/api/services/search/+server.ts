import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { service, serviceView } from '$lib/server/db/schema';
import { db } from '$lib/server/db';
import { count, sql } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request }) => {
	const requestData = await request.json();
	var { pageSize, page, facets, filters } = requestData;
	const stageMapping = {
		DEV: 'Developmental',
		DEMO: 'Demonstration',
		PROD: 'Operational'
	} as const;
	const stageFilterToEnumMapping = Object.fromEntries(
		Object.entries(stageMapping).map(([enumValue, label]) => [label, enumValue])
	) as Record<string, keyof typeof stageMapping>;

	if (!pageSize) pageSize = 10;
	if (!page) page = 0;

	let db_services = await db.select().from(serviceView).orderBy(serviceView.name);

	var db_facets: Record<string, { value: string; count: number }[]> = {};
	for (const [key, facet] of Object.entries(facets as Array<{ mapping: string }>)) {
		if (facet.mapping === 'category') {
			db_facets[key] = db_services.reduce(
				(acc, service) => {
					const category = service.category || 'Uncategorized';
					const existing = acc.find(
						(item: { value: string; count: number }) => item.value === category
					);
					if (existing) {
						existing.count += 1;
					} else {
						acc.push({ value: category, count: 1 });
					}
					return acc;
				},
				[] as { value: string; count: number }[]
			);
		}
		if (facet.mapping === 'consortia') {
			db_facets[key] = db_services.reduce(
				(acc, service) => {
					const consortia = (service.consortia as Array<{
						name: string;
						abbreviation: string;
					}>) || [{ name: 'N/A', abbreviation: 'n/a' }];
					consortia.forEach((consortium: { name: string; abbreviation: string }) => {
						const existing = acc.find(
							(item: { value: string; count: number }) => item.value === consortium.name
						);
						if (existing) {
							existing.count += 1;
						} else {
							acc.push({ value: consortium.name, count: 1 });
						}
					});
					return acc;
				},
				[] as { value: string; count: number }[]
			);
		}
		if (facet.mapping === 'stage') {
			db_facets[key] = db_services.reduce(
				(acc, service) => {
					const stage = service.stage || 'Unknown';
					const existing = acc.find(
						(item: { value: string; count: number }) =>
							item.value === stageMapping[stage as keyof typeof stageMapping]
					);
					if (existing) {
						existing.count += 1;
					} else {
						acc.push({
							value: stageMapping[stage as keyof typeof stageMapping] ?? stage,
							count: 1
						});
					}
					return acc;
				},
				[] as { value: string; count: number }[]
			);
		}
		if (facet.mapping === 'license') {
			db_facets[key] = db_services.reduce(
				(acc, service) => {
					const license = service.license || 'Unknown';
					const existing = acc.find(
						(item: { value: string; count: number }) => item.value === license
					);
					if (existing) {
						existing.count += 1;
					} else {
						acc.push({ value: license, count: 1 });
					}
					return acc;
				},
				[] as { value: string; count: number }[]
			);
		}
	}

	let service_filters: Record<string, string[]> = {};
	for (const filter of filters as Array<string>) {
		let [key, value] = filter.split(':');
		key = facets[key.slice(1, key.length)].mapping;
		if (key === 'stage') {
			value = stageFilterToEnumMapping[value] ?? value;
		}
		if (!service_filters[key]) {
			service_filters[key] = [];
		}
		service_filters[key].push(value);
	}

	db_services = db_services.filter((service) => {
		for (const [key, values] of Object.entries(service_filters)) {
			const serviceValue = service[key as keyof typeof service];
			if (Array.isArray(serviceValue)) {
				const serviceValueNames = serviceValue.map((item: any) => item.name);
				if (!values.some((value) => serviceValueNames.includes(value))) {
					return false;
				}
			} else {
				if (!values.includes(serviceValue as string)) {
					return false;
				}
			}
		}
		return true;
	});

	return json({
		metadata: {
			totalCount: db_services.length,
			currentPage: page,
			pageSize,
			totalPages: Math.ceil(db_services.length / pageSize)
		},
		services: db_services.slice(page * pageSize, (page + 1) * pageSize),
		facets: db_facets
	});
};
