import { db } from '$lib/server/db';
import { settings, authCodes } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { OIDC_STATE_BYTES } from '$lib/server/constants';

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const GET: RequestHandler = async ({ url }) => {
	const name = url.searchParams.get('provider');

	const result = await db.select().from(settings).where(eq(settings.key, 'security'));

	const providers = (result[0]?.value as Record<string, any>)?.['OIDC Providers'] as any[];

	const provider = providers.find((p) => p.Name === name);

	let searchParams = new URLSearchParams();
	searchParams.set('client_id', provider['Client ID']);
	searchParams.set('response_type', 'code');
	searchParams.set('scope', 'openid profile email');
	searchParams.set('redirect_uri', new URL(resolve('/login/oidc/callback/'), url).toString());
	const stateBytes = crypto.getRandomValues(new Uint8Array(OIDC_STATE_BYTES));
	searchParams.set('state', toHex(stateBytes));

	const config = await fetch(provider['Specification URL']).then((res) => res.json());
	const authorizationEndpoint = config.authorization_endpoint;

	// store state in database with provider JSON
	await db.insert(authCodes).values({
		state: searchParams.get('state')!,
		provider: provider
	});

	const authUrl = `${authorizationEndpoint}?${searchParams.toString()}`;

	throw redirect(302, authUrl);
};
