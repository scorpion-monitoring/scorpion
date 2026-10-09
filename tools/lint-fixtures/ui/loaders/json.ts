import { json } from '@sveltejs/kit';

export const load = () => json({ error: 'bad token' }, { status: 400 });
