import { MAXIMUM_ENTITIES } from '$lib/constants';
import { query } from '$lib/db/mysql.server';
import { decrypt, encrypt } from '$lib/utils/encryption';
import { Result } from '$lib/utils/result';
import { nowUtc } from '$lib/utils/time';
import type { Auth } from '../auth/auth.server';
import { Label } from '../label/label.server';
import { Event as _Event, type RawEvent } from './event';
import { UId } from '$lib/controllers/uuid/uuid.server';

namespace EventServer {
    export async function all(auth: Auth): Promise<Result<Event[]>> {
        const { err, val: labels } = await Label.Server.all(auth);
        if (err) return Result.err(err);

        const rawEvents = await query<RawEvent[]>`
            SELECT id,
                   name,
                   start,
                   end,
                   label,
                   created
            FROM events
            WHERE user = ${auth.id}
            ORDER BY created DESC
        `;

        const events = [];

        for (const rawEvent of rawEvents) {
            const { err, val } = await fromRaw(auth, rawEvent, labels);
            if (err) return Result.err(err);
            events.push(val);
        }

        return Result.ok(events);
    }

    export async function fromId(auth: Auth, id: string): Promise<Result<Event>> {
        const events = await query<RawEvent[]>`
            SELECT id,
                   name,
                   start,
                   end,
                   label
            FROM events
            WHERE user = ${auth.id}
              AND id = ${id}
        `;

        if (events.length !== 1) {
            return Result.err(`Event not found`);
        }

        return await fromRaw(auth, events[0]);
    }

    export async function fromRaw(
        auth: Auth,
        rawEvent: RawEvent,
        labels?: Label[]
    ): Promise<Result<Event>> {
        const { err, val: nameDecrypted } = decrypt(rawEvent.name, auth.key);
        if (err) return Result.err(err);

        const event = {
            id: rawEvent.id,
            name: nameDecrypted,
            start: rawEvent.start,
            end: rawEvent.end,
            created: rawEvent.created
        } as Event;

        if (rawEvent.label) {
            if (labels) {
                event.label = labels.find(l => l.id === rawEvent.label);
            }
            if (!event.label) {
                const { err } = await addLabel(auth, event, rawEvent.label);
                if (err) return Result.err(err);
            }
            if (!event.label) {
                return Result.err('Label not found');
            }
        }

        return Result.ok(event);
    }

    export async function create(
        auth: Auth,
        name: string,
        start: TimestampSecs,
        end: TimestampSecs,
        label?: string,
        created?: TimestampSecs
    ): Promise<Result<Event>> {
        const numEvents = await query<{ count: number }[]>`
            SELECT COUNT(*) as count
            FROM events
            WHERE user = ${auth.id}
        `;
        if (numEvents[0].count >= MAXIMUM_ENTITIES.event) {
            return Result.err(`Maximum number of events (${MAXIMUM_ENTITIES.event}) reached`);
        }

        const id = await UId.Server.generate();
        created ??= nowUtc();

        if (!name) {
            return Result.err('Event name cannot be empty');
        }

        const event = { id, name, start, end, created };

        if (label) {
            const { err } = await addLabel(auth, event, label);
            if (err) return Result.err(err);
        }

        const nameEncrypted = encrypt(name, auth.key);

        if (nameEncrypted.length > 256) {
            return Result.err('Name too long');
        }

        await query`
            INSERT INTO events
                (id, user, name, start, end, created, label)
            VALUES (${id},
                    ${auth.id},
                    ${nameEncrypted},
                    ${start},
                    ${end},
                    ${created},
                    ${label || null})
        `;

        return Result.ok(event);
    }

    export async function purgeAll(auth: Auth): Promise<void> {
        await query`
            DELETE
            FROM events
            WHERE user = ${auth.id}
        `;
    }

    export async function updateName(
        auth: Auth,
        self: Event,
        namePlaintext: string
    ): Promise<Result<Event>> {
        if (!namePlaintext) {
            return Result.err('Event name cannot be empty');
        }
        self.name = namePlaintext;

        const nameEncrypted = encrypt(namePlaintext, auth.key);

        if (nameEncrypted.length > 256) {
            return Result.err('Name too long');
        }

        await query`
            UPDATE events
            SET name = ${nameEncrypted}
            WHERE id = ${self.id}
        `;
        return Result.ok(self);
    }

    export async function updateStart(
        auth: Auth,
        self: Event,
        start: TimestampSecs
    ): Promise<Result<Event>> {
        if (start > self.end) {
            const { err } = await updateEnd(
                auth,
                self,
                // If trying to update start to be after end,
                // update end to be 1 hour after start
                start + 60 * 60
            );
            if (err) return Result.err(err);
        }
        self.start = start;
        await query`
            UPDATE events
            SET start = ${start}
            WHERE id = ${self.id}
              AND user = ${auth.id}
        `;
        return Result.ok(self);
    }

    export async function updateEnd(
        auth: Auth,
        self: Event,
        end: TimestampSecs
    ): Promise<Result<Event>> {
        if (end < self.start) {
            const { err } = await updateStart(
                auth,
                self,
                // If trying to update end to be before start,
                // update start to be 1 hour before end
                end - 60 * 60
            );
            if (err) return Result.err(err);
        }
        self.end = end;
        await query`
            UPDATE events
            SET end = ${end}
            WHERE id = ${self.id}
              AND user = ${auth.id}
        `;
        return Result.ok(self);
    }

    export async function updateStartAndEnd(
        auth: Auth,
        self: Event,
        start: TimestampSecs,
        end: TimestampSecs
    ): Promise<Result<Event>> {
        if (start > end) {
            return Result.err('Start time cannot be after end time');
        }
        self.start = start;
        self.end = end;
        await query`
            UPDATE events
            SET   start = ${start},
                  end   = ${end}
            WHERE id = ${self.id}
              AND user = ${auth.id}
        `;
        return Result.ok(self);
    }

    export async function updateLabel(
        auth: Auth,
        self: Event,
        labelId: string
    ): Promise<Result<Event>> {
        if (!labelId) {
            delete self.label;
            await query`
                UPDATE events
                SET label = NULL
                WHERE id = ${self.id}
                  AND user = ${auth.id}
            `;
            return Result.ok(self);
        }

        const { err } = await addLabel(auth, self, labelId);
        if (err) return Result.err(err);

        await query`
            UPDATE events
            SET label = ${labelId}
            WHERE id = ${self.id}
              AND user = ${auth.id}
        `;

        return Result.ok(self);
    }

    export async function purge(auth: Auth, self: Event): Promise<Result<null>> {
        await query`
            DELETE
            FROM events
            WHERE id = ${self.id}
              AND user = ${auth.id}
        `;
        return Result.ok(null);
    }

    export async function withLabel(auth: Auth, labelId: string): Promise<Result<Event[]>> {
        const { err } = await Label.Server.fromId(auth, labelId);
        if (err) return Result.err(err);

        const { val: events, err: allErr } = await all(auth);
        if (allErr) return Result.err(allErr);

        return Result.ok(events.filter(evt => evt.label?.id === labelId));
    }

    export async function reassignAllLabels(
        auth: Auth,
        oldLabel: string,
        newLabel: string
    ): Promise<Result<null>> {
        await query`
            UPDATE events
            SET label = ${newLabel}
            WHERE label = ${oldLabel}
              AND user = ${auth.id}
        `;
        return Result.ok(null);
    }

    export async function removeAllLabel(auth: Auth, labelId: string): Promise<Result<null>> {
        await query`
            UPDATE events
            SET label = NULL
            WHERE label = ${labelId}
              AND user = ${auth.id}
        `;
        return Result.ok(null);
    }

    async function addLabel(
        auth: Auth,
        self: Event,
        label: Label | string
    ): Promise<Result<Event>> {
        if (typeof label === 'string') {
            const { val, err } = await Label.Server.fromId(auth, label);
            if (err) {
                return Result.err(err);
            }
            self.label = val;
        } else {
            self.label = label;
        }

        return Result.ok(self);
    }
}

export const Event = {
    ..._Event,
    Server: EventServer
};
export type Event = _Event;
