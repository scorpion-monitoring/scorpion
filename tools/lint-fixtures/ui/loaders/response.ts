// A loader that returns a response instead of throwing (defect 12).
export const load = () => new Response('bad token', { status: 400 });
export const other = () => Response.json({ error: 'bad token' }, { status: 400 });
