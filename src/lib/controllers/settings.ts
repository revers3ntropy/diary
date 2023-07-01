import { errorLogger } from '$lib/utils/log';
import type { QueryFunc } from '../db/mysql';
import { decrypt, encrypt } from '../security/encryption';
import { Result } from '../utils/result';
import { nowUtc } from '../utils/time';
import type { Auth } from './user';
import { UUID } from './uuid';

export interface SettingConfig<T extends SettingValue> {
    type: 'string' | 'boolean' | 'number';
    name: string;
    description: string;
    defaultValue: T;
    showInSettings: boolean;
    unit?: string;
}

export type SettingValue = string | boolean | number;
export type SettingsKey = keyof typeof Settings.config;
export type SettingsConfig = {
    [key in SettingsKey]: Settings<(typeof Settings.config)[key]['defaultValue']>;
};

export class Settings<T = unknown> {
    public static config = {
        hideEntriesByDefault: {
            type: 'boolean',
            defaultValue: false,
            name: 'Blur Entries By Default',
            description: 'Blur entries by default, and manually show them.',
            showInSettings: true
        } as SettingConfig<boolean>,
        entryFormMode: {
            type: 'boolean',
            defaultValue: false,
            name: 'Use Bullet Mode',
            description: 'Write entries in Bullet Journaling mode.',
            showInSettings: false
        } as SettingConfig<boolean>,
        showAgentWidgetOnEntries: {
            type: 'boolean',
            defaultValue: false,
            name: 'Show Device',
            description: 'Shows the operating system of the device the entry was submitted on.',
            showInSettings: true
        } as SettingConfig<boolean>,
        autoHideEntriesDelay: {
            type: 'number',
            defaultValue: 0,
            name: 'Auto Blur Entries After',
            description:
                `Blur entries after 'N' seconds without user interaction. ` +
                `Set to 0 to disable.`,
            showInSettings: true,
            unit: 'seconds'
        } as SettingConfig<Seconds>,
        passcode: {
            type: 'string',
            defaultValue: '',
            name: 'Passcode',
            description: `Passcode to access the app. Leave blank to disable.`,
            showInSettings: true
        } as SettingConfig<string>,
        passcodeTimeout: {
            type: 'number',
            defaultValue: 0,
            name: 'Passcode Timeout',
            description:
                `Delay before passcode is required again. ` +
                `Set to 0 to only require once per device.`,
            showInSettings: true,
            unit: 'seconds'
        } as SettingConfig<Seconds>,
        yearOfBirth: {
            type: 'number',
            defaultValue: 2000,
            name: 'Year of Birth',
            description: `The first year in which you lived. Used by the timeline.`,
            showInSettings: true
        } as SettingConfig<number>,
        showNYearsAgoEntryTitles: {
            type: 'boolean',
            defaultValue: true,
            name: 'Show "On this Day" Entries',
            description: `Show entries which happened on this day some number of years ago on the home page.`,
            showInSettings: true
        } as SettingConfig<boolean>
    } satisfies Record<string, SettingConfig<SettingValue>>;

    constructor(
        public readonly id: string,
        public readonly created: number,
        public readonly key: string,
        public readonly value: T
    ) {}

    public static async update(
        query: QueryFunc,
        auth: Auth,
        key: string,
        value: unknown
    ): Promise<Result<Settings>> {
        if (!(key in Settings.config)) {
            return Result.err(`Invalid setting key`);
        }

        const now = nowUtc();

        const expectedType = Settings.config[key as SettingsKey].type;
        if (typeof value !== expectedType) {
            return Result.err(
                `Invalid setting value, expected ${expectedType} but got ${typeof value}`
            );
        }

        const { err, val: valEncrypted } = encrypt(JSON.stringify(value), auth.key);
        if (err) return Result.err(err);

        const alreadyInDb = await query<{ id: string }[]>`
            SELECT id from settings
            WHERE user = ${auth.id}
                AND \`key\` = ${key}
        `;

        if (alreadyInDb.length > 0) {
            const id = alreadyInDb[0].id;
            await query`
                UPDATE settings
                SET 
                    value = ${valEncrypted},
                    created = ${now}
                WHERE id = ${id}
            `;
            return Result.ok(new Settings(id, now, key, value));
        }

        const id = await UUID.generateUUId(query);

        await query`
            INSERT INTO settings (id, user, created, \`key\`, value)
            VALUES (${id}, ${auth.id}, ${now}, ${key}, ${valEncrypted})
        `;

        return Result.ok(new Settings(id, now, key, value));
    }

    /**
     * This should very rarely be called,
     * only as an error correction measure
     */
    public static async clearDuplicateKeys(
        query: QueryFunc,
        auth: Auth,
        duplicated: Set<string>
    ): Promise<void> {
        errorLogger.error('Clearing duplicate settings keys: ', [...duplicated]);
        for (const key of duplicated) {
            await query`
                DELETE FROM settings
                WHERE user = ${auth.id}
                    AND \`key\` = ${key}
                ORDER BY created
                LIMIT 1
            `;
        }
    }

    public static async all(query: QueryFunc, auth: Auth): Promise<Result<Settings[]>> {
        const settings = await query<
            {
                id: string;
                created: number;
                key: string;
                value: string;
            }[]
        >`
            SELECT created, id, \`key\`, value
            FROM settings
            WHERE user = ${auth.id}
        `;

        // check for duplicates
        const seenKeys = new Set<string>();
        const duplicateKeys = new Set<string>();
        settings.forEach(setting => {
            if (seenKeys.has(setting.key)) {
                duplicateKeys.add(setting.key);
            }
            seenKeys.add(setting.key);
        });
        if (duplicateKeys.size > 0) {
            await Settings.clearDuplicateKeys(query, auth, duplicateKeys);
        }

        return Result.collect(
            settings.map(setting => {
                const { err, val: unencryptedVal } = decrypt(setting.value, auth.key);
                if (err) return Result.err(err);
                return Result.ok(
                    new Settings(
                        setting.id,
                        setting.created,
                        setting.key,
                        JSON.parse(unencryptedVal)
                    )
                );
            })
        );
    }

    public static async getValue<T extends keyof typeof Settings.config>(
        query: QueryFunc,
        auth: Auth,
        key: T
    ): Promise<Result<(typeof Settings.config)[T]['defaultValue']>> {
        const settings = await query<
            {
                id: string;
                created: number;
                key: string;
                value: string;
            }[]
        >`
            SELECT created, id, \`key\`, value
            FROM settings
            WHERE user = ${auth.id}
                AND \`key\` = ${key}
        `;

        if (settings.length < 1) {
            return Result.ok(Settings.config[key].defaultValue);
        }
        const { err, val } = decrypt(settings[0].value, auth.key);
        if (err) return Result.err(err);
        return Result.ok(JSON.parse(val) as (typeof Settings.config)[T]['defaultValue']);
    }

    public static async allAsMap(
        query: QueryFunc,
        auth: Auth
    ): Promise<Result<Partial<SettingsConfig>>> {
        const res = await Settings.all(query, auth);
        if (res.err) {
            return Result.err(res.err);
        }
        return Result.ok(
            Object.fromEntries(res.val.map(s => [s.key, s])) as Partial<SettingsConfig>
        );
    }

    public static convertToMap(settings: Settings[]): SettingsConfig {
        return Object.fromEntries(settings.map(s => [s.key, s])) as SettingsConfig;
    }

    public static fillWithDefaults(map: Record<string, Settings>): SettingsConfig {
        const newMap = { ...map };
        for (const [key, config] of Object.entries(Settings.config)) {
            if (!newMap[key]) {
                newMap[key] = new Settings('', 0, key, config.defaultValue);
            }
        }
        return newMap as SettingsConfig;
    }

    public static async purgeAll(query: QueryFunc, auth: Auth): Promise<Result> {
        await query`
            DELETE
            FROM settings
            WHERE user = ${auth.id}
        `;
        return Result.ok(null);
    }

    public static async changeEncryptionKeyInDB(
        query: QueryFunc,
        auth: Auth,
        newKey: string
    ): Promise<Result> {
        const { val: unencryptedSettings, err } = await Settings.all(query, auth);
        if (err) return Result.err(err);
        for (const setting of unencryptedSettings) {
            const { err, val: newValue } = encrypt(JSON.stringify(setting.value), newKey);
            if (err) return Result.err(err);

            await query`
                UPDATE settings
                SET value = ${newValue}
                WHERE id = ${setting.id}
            `;
        }
        return Result.ok(null);
    }
}
