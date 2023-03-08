import { redirect } from '@sveltejs/kit';
import { Entry } from '../../../lib/controllers/entry';
import { query } from '../../../lib/db/mysql';
import { getAuthFromCookies } from '../../../lib/security/getAuthFromCookies';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
    const auth = await getAuthFromCookies(cookies);

    const { val: entry, err } = await Entry.fromId(
        query, auth,
        params.entryId, false,
    );
    if (err) throw redirect(307, '/diary');

    return entry.json();
};
