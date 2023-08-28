import { MAXIMUM_ENTITIES } from '$lib/constants';
import { query } from '$lib/db/mysql.server';
import { decrypt, encrypt } from '$lib/utils/encryption';
import { Result } from '$lib/utils/result';
import { nowUtc } from '$lib/utils/time';
import { z } from 'zod';
import type { Auth } from '../auth/auth.server';
import type { Label as _Label, LabelWithCount } from './label';
import { UId } from '$lib/controllers/uuid/uuid.server';

namespace LabelServer {
    type Label = _Label;

    export async function fromId(auth: Auth, id: string): Promise<Result<Label>> {
        const res = await query<Required<Label>[]>`
            SELECT id, color, name, created
            FROM labels
            WHERE id = ${id}
              AND user = ${auth.id}
        `;

        if (res.length !== 1) {
            return Result.err('Label not found');
        }

        const { err, val: nameDecrypted } = decrypt(res[0].name, auth.key);
        if (err) return Result.err(err);

        return Result.ok({
            id: res[0].id,
            color: res[0].color,
            name: nameDecrypted,
            created: res[0].created
        });
    }

    export async function getIdFromName(
        auth: Auth,
        nameDecrypted: string
    ): Promise<Result<string>> {
        const encryptedName = encrypt(nameDecrypted, auth.key);

        const res = await query<Required<Label>[]>`
            SELECT id
            FROM labels
            WHERE name = ${encryptedName}
              AND user = ${auth.id}
        `;

        if (res.length !== 1) {
            return Result.err('No Label with that name');
        }

        return Result.ok(res[0].id);
    }

    export async function fromName(auth: Auth, nameDecrypted: string): Promise<Result<Label>> {
        const encryptedName = encrypt(nameDecrypted, auth.key);

        const res = await query<Required<Label>[]>`
            SELECT id, color, name, created
            FROM labels
            WHERE name = ${encryptedName}
              AND user = ${auth.id}
        `;

        if (res.length !== 1) {
            return Result.err('Label not found');
        }

        return Result.ok({
            id: res[0].id,
            color: res[0].color,
            name: nameDecrypted,
            created: res[0].created
        });
    }

    export async function all(auth: Auth): Promise<Result<Label[]>> {
        const res = await query<Required<Label>[]>`
            SELECT id, color, name, created
            FROM labels
            WHERE user = ${auth.id}
        `;

        return Result.collect(
            res.map(label => {
                const { err, val: nameDecrypted } = decrypt(label.name, auth.key);
                if (err) return Result.err(err);
                return Result.ok({
                    id: label.id,
                    color: label.color,
                    name: nameDecrypted,
                    created: label.created
                });
            })
        );
    }

    export async function userHasLabelWithId(auth: Auth, id: string): Promise<boolean> {
        return (await fromId(auth, id)).ok;
    }

    export async function userHasLabelWithName(
        auth: Auth,
        nameDecrypted: string
    ): Promise<boolean> {
        return (await fromName(auth, nameDecrypted)).ok;
    }

    export async function purgeWithId(auth: Auth, id: string): Promise<void> {
        await query`
            DELETE
            FROM labels
            WHERE id = ${id}
              AND user = ${auth.id}
        `;
    }

    export async function purgeAll(auth: Auth): Promise<void> {
        await query`
            DELETE
            FROM labels
            WHERE user = ${auth.id}
        `;
    }

    async function canCreateWithName(auth: Auth, name: string): Promise<string | true> {
        if (await userHasLabelWithName(auth, name)) {
            return 'Label with that name already exists';
        }

        const numLabels = await query<{ count: number }[]>`
            SELECT COUNT(*) as count    
            FROM labels
            WHERE user = ${auth.id}
        `;
        if (numLabels[0].count >= MAXIMUM_ENTITIES.label) {
            return `Maximum number of labels (${MAXIMUM_ENTITIES.label}) reached`;
        }

        return true;
    }

    export async function create(
        auth: Auth,
        json: PickOptional<Label, 'id' | 'created'>
    ): Promise<Result<Label>> {
        const canCreate = await canCreateWithName(auth, json.name);
        if (canCreate !== true) return Result.err(canCreate);

        const id = await UId.Server.generate();
        const created = json.created ?? nowUtc();

        const encryptedName = encrypt(json.name, auth.key);

        if (encryptedName.length > 256) {
            return Result.err('Name too long');
        }

        await query`
            INSERT INTO labels (id, user, name, color, created)
            VALUES (${id},
                    ${auth.id},
                    ${encryptedName},
                    ${json.color},
                    ${created})
        `;

        return Result.ok({
            id,
            color: json.color,
            name: json.name,
            created
        });
    }

    export async function updateName(
        auth: Auth,
        label: Label,
        name: string
    ): Promise<Result<Label>> {
        if (await userHasLabelWithName(auth, name)) {
            return Result.err('Label with that name already exists');
        }

        const encryptedName = encrypt(name, auth.key);

        if (encryptedName.length > 256) {
            return Result.err('Name too long');
        }

        await query`
            UPDATE labels
            SET name = ${encryptedName}
            WHERE id = ${label.id}
        `;

        label.name = name;

        return Result.ok(label);
    }

    export async function updateColor(label: Label, color: string): Promise<Result<Label>> {
        await query`
            UPDATE labels
            SET color = ${color}
            WHERE id = ${label.id}
        `;

        label.color = color;

        return Result.ok(label);
    }

    export async function allWithCounts(auth: Auth): Promise<Result<LabelWithCount[]>> {
        const { err, val: labels } = await all(auth);
        if (err) return Result.err(err);

        return Result.ok(
            await Promise.all(
                labels.map(async label => {
                    const entryCount = await query<{ count: number }[]>`
                SELECT COUNT(*) as count
                FROM entries
                WHERE user = ${auth.id}
                  AND label = ${label.id}
            `;
                    const eventCount = await query<{ count: number }[]>`
                SELECT COUNT(*) as count
                FROM events
                WHERE user = ${auth.id}
                  AND label = ${label.id}
            `;
                    const editCount = await query<{ count: number }[]>`
                SELECT COUNT(*) as count
                FROM entryEdits,
                     entries
                WHERE entryEdits.entry = entries.id
                  AND entries.user = ${auth.id}
                  AND entryEdits.label = ${label.id}
            `;

                    return {
                        ...label,
                        entryCount: entryCount[0].count + editCount[0].count,
                        eventCount: eventCount[0].count
                    };
                })
            )
        );
    }

    export function jsonIsRawLabel(
        json: unknown
    ): json is { name: string; color: string; created?: number } {
        const schema = z.object({
            name: z.string(),
            color: z.string(),
            created: z.number().optional()
        });

        return schema.safeParse(json).success;
    }
}

export const Label = {
    Server: LabelServer
};
export type Label = _Label;
