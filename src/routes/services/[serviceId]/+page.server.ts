import type { PageServerLoad } from './$types';
import * as jose from 'jose';
import { JWT_SECRET } from '$env/static/private';
import { db } from '$lib/server/db';
import {
	category,
	consortium,
	indicator,
	provider,
	publication,
	service,
	userToProvider
} from '$lib/server/db/schema';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { bulkSearch } from '$lib/server/openalex';

const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET.toString());

export const load: PageServerLoad = async ({ cookies, url }) => {
	const serviceId = url.pathname.split('/').pop();

	const dois = [
		'10.3835/plantgenome2015.06.0038',
		'10.1016/j.jbiotec.2017.06.003',
		'10.1016/j.jbiotec.2017.07.006',
		'10.1159/000356460',
		'10.1093/bioinformatics/btx198',
		'10.1007/978-3-319-92528-8_21',
		'10.1038/s41588-018-0266-x',
		'10.1111/tpj.14179',
		'10.1038/s41588-019-0443-6',
		'10.1093/bioinformatics/btz190',
		'10.1111/tpj.14645',
		'10.3389/fpls.2020.00701',
		'10.1038/s41586-020-2947-8',
		'10.1038/s41586-020-2961-x',
		'10.1007/978-981-16-6795-4_2',
		'10.1038/s41586-024-08187-1',
		'10.1093/bioadv/vbae185',
		'10.1038/s41588-024-02069-y',
		'10.1093/database/baaf048'
	];

	// const openAlexData = await bulkSearch(dois);
	// // console.log(openAlexData);

	// let ctr = 0;
	// for (const item of openAlexData) {
	// 	console.log(`Title: ${item.title}`);
	// 	console.log(`DOI: ${item.doi}`);
	// 	console.log(`Authors: ${item.authorships.map((a: any) => a.author.display_name).join(', ')}`);
	// 	console.log(`Cited by count: ${item.cited_by_count}`);
	// 	console.log('---');
	// 	ctr = ctr+item.cited_by_count;
	// }

	// console.log(`Total citations for these 19 papers: ${ctr}`);

	return {
		publications: await db
			.select({ ...getTableColumns(publication) })
			.from(publication)
			.innerJoin(service, eq(service.id, publication.serviceId))
			.where(eq(service.abbreviation, serviceId!))
			.orderBy(publication.publicationDate),
		providers: await db.select().from(provider).orderBy(provider.name),
		userProviders: await getUserProviders(cookies),
		consortia: await db.select().from(consortium).orderBy(consortium.name),
		categories: await db.select().from(category).orderBy(category.name),
		indicators: await db.select().from(indicator).orderBy(indicator.name)
	};
};

async function getUserProviders(cookies: any) {
	let token = cookies.get('access_token');
	if (!token) {
		return new Response(null, { status: 400 });
	}

	var jwt = await jose.jwtVerify(token, JWT_SECRET_BYTES);
	const { payload } = jwt;
	if (!payload.userId) {
		return new Response(null, { status: 400 });
	}

	let userId = payload.userId as string;

	const userProviders = await db
		.select()
		.from(userToProvider)
		.where(eq(userToProvider.userId, userId))
		.innerJoin(provider, eq(provider.id, userToProvider.providerId));

	return userProviders.map((row) => ({
		id: row.provider.id,
		abbreviation: row.provider.abbreviation,
		name: row.provider.name
	}));
}
