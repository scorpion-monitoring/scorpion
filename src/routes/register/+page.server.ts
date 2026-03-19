import type { Actions, PageServerLoad } from './$types';
import * as auth from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { SESSION_TTL_MS } from '$lib/server/constants';

export const load: PageServerLoad = async () => {
	const securitySettings = await db.select().from(settings).where(eq(settings.key, 'security'));
	return {
		allowLocal: (securitySettings[0].value as { 'Local Accounts': any })['Local Accounts'] === 'yes'
	};
};

export const actions: Actions = {
	register: async (event) => {
		const formData = await event.request.formData();
		const username = formData.get('username');
		const email = formData.get('email');
		const password = formData.get('password');
		const repeat = formData.get('repeat');

		if (!username || !email || !password || !repeat) {
			return {
				message: 'All fields are required'
			};
		}

		if (password !== repeat) {
			return fail(400, {
				message: 'Passwords do not match'
			});
		}

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
		let jwt;
		try {
			jwt = await auth.registerUser(username as string, email as string, password as string);
		} catch (error: any) {
			return fail(400, {
				message: error.message || 'Registration failed'
			});
		}
		event.cookies.set('access_token', jwt, {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			expires: new Date(Date.now() + SESSION_TTL_MS) // 7 days
		});

		return redirect(302, resolve('/login/fallback'));
	}
};

// async function sendEmail(options: { to: string; from: string; replyTo: string; subject: string; body: string }) {
// 	console.log('Sending email with options:', options);
//     const transporter = nodemailer.createTransport({
//         host: 's1192.mx.srv.dfn.de',
//         port: 587,
//         secure: false,
//     });
// }

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
