import { fail, redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { settings, user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { resolve } from '$app/paths';
import { SESSION_TTL_MS } from '$lib/server/constants';

export const load: PageServerLoad = async () => {
	const securitySettings = await db.select().from(settings).where(eq(settings.key, 'security'));
	return {
		oidc_providers:
			securitySettings.length > 0
				? (securitySettings[0].value as { 'OIDC Providers': any })['OIDC Providers']?.map(
						(provider: any) => ({
							'Display Icon': provider['Display Icon'],
							Name: provider['Name'],
							'Client ID': provider['Client ID'],
							'Specification URL': provider['Specification URL']
						})
					)
				: [],
		allowLocal: (securitySettings[0].value as { 'Local Accounts': any })['Local Accounts'] === 'yes'
	};
};

export const actions: Actions = {
	login: async (event) => {
		const formData = await event.request.formData();
		const username = formData.get('username');
		const password = formData.get('password');

		if (!validateUsername(username)) {
			return fail(400, {
				message: 'Invalid username (min 3, max 31 characters, alphanumeric only)'
			});
		}

		if (!validatePassword(password)) {
			return fail(400, {
				message: 'Invalid password (min 6, max 255 characters)'
			});
		}

		const userRecord = await auth.authenticateUser(username, password);

		if (!userRecord) {
			return fail(400, { message: 'Invalid username or password' });
		}

		const jwt = await auth.createJWTSession(userRecord.user);

		// set jwt in cookie
		event.cookies.set('access_token', jwt, {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			expires: new Date(Date.now() + SESSION_TTL_MS) // 7 days
		});

		if (userRecord.user.approved) {
			return redirect(302, resolve('/'));
		} else {
			return redirect(302, resolve('/login/fallback'));
		}
	}
};

function validateUsername(username: unknown): username is string {
	return (
		typeof username === 'string' &&
		username.length >= 3 &&
		username.length <= 31 &&
		/^[a-z0-9_-]+$/.test(username)
	);
}

function validatePassword(password: unknown): password is string {
	return typeof password === 'string' && password.length >= 6 && password.length <= 255;
}
