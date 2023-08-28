import { Entry } from '$lib/controllers/entry/entry.server';
import { fmtUtc, nowUtc } from '$lib/utils/time';
import { error } from '@sveltejs/kit';
import { query } from '$lib/db/mysql.server';
import { cachedPageRoute } from '$lib/utils/cache.server';
import type { PageServerLoad } from './$types';
import { Dataset } from '$lib/controllers/dataset/dataset.server';

const NUMBER_OF_RECENT_TITLES = 6;

function entriesYearsAgoToday(entries: Entry[]): Record<string, Entry[]> {
    const res: Record<string, Entry[]> = {};
    // TODO use client time zone
    const nowDate = fmtUtc(nowUtc(), 0, 'MM-DD');
    const nowYear = fmtUtc(nowUtc(), 0, 'YYYY');

    for (const entry of entries) {
        const entryDate = fmtUtc(entry.created, entry.createdTZOffset, 'MM-DD');
        // entries on the same day and month, but not this year
        if (entryDate === nowDate) {
            const entryYear = fmtUtc(entry.created, entry.createdTZOffset, 'YYYY');
            if (entryYear !== nowYear) {
                const yearsAgo = parseInt(nowYear) - parseInt(entryYear);
                if (!res[yearsAgo]) {
                    res[yearsAgo] = [];
                }
                res[yearsAgo].push(entry);
            }
        }
    }
    return res;
}

export const load = cachedPageRoute(async (auth, { parent, locals }) => {
    const { val: titles, err } = await Entry.Server.getTitles(auth);
    if (err) throw error(400, err);

    const firstNTitles = Entry.groupEntriesByDay<Entry>(
        titles.sort((a, b) => b.created - a.created).slice(0, NUMBER_OF_RECENT_TITLES)
    );

    // settings set by root layout
    await parent();

    const settings = locals.settings;
    if (!settings) throw error(400, 'Settings not found');

    let nYearsAgo = {} as Record<string, Entry[]>;
    if (settings.showNYearsAgoEntryTitles.value) {
        nYearsAgo = entriesYearsAgoToday(titles);
    }

    const pinned = titles.filter(Entry.isPinned);

    const { val: datasets, err: datasetsErr } = await Dataset.Server.allMetaData(
        query,
        auth,
        settings
    );
    if (datasetsErr) throw error(400, datasetsErr);

    return {
        recentTitles: firstNTitles,
        nYearsAgo,
        pinnedEntriesList: pinned,
        datasets
    };
}) satisfies PageServerLoad;
