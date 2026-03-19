import * as auth from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const accessToken = cookies.get('access_token');

	if (accessToken) {
		const user = await auth.getUserFromJWT(accessToken);
		return {
			user: { username: user?.username, email: user?.email }
		};
	} else {
		return {
			user: null
		};
	}
};
