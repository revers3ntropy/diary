import { PUBLIC_GITHUB_AUTH_CLIENT_ID } from '$env/static/public';
import type { QueryFunc } from '$lib/db/mysql.server';
import { encryptionKeyFromPassword } from '$lib/security/authUtils.server';
import { encrypt } from '$lib/security/encryption.server';
import { errorLogger } from '$lib/utils/log.server';
import { Result } from '$lib/utils/result';
import { cryptoRandomStr } from '$lib/security/authUtils.server';
import { nowUtc } from '$lib/utils/time';
import { GITHUB_AUTH_CLIENT_SECRET } from '$env/static/private';
import { Asset } from '../asset/asset.server';
import { Backup } from '../backup/backup';
import { Entry } from '../entry/entry';
import { Event } from '../event/event';
import { Label } from '../label/label';
import { Settings } from '../settings/settings';
import { UUId } from '../uuid/uuid';
import type { Auth, User as _User } from './user';

export type User = _User;

namespace UserUtils {
    export async function authenticate(
        query: QueryFunc,
        username: string,
        key: string
    ): Promise<Result<User>> {
        const res = await query<{ id: string }[]>`
            SELECT id
            FROM users
            WHERE username = ${username}
              AND password = SHA2(CONCAT(${key}, salt), 256)
        `;
        if (res.length !== 1) {
            return Result.err('Invalid login');
        }
        return Result.ok({ id: res[0].id, username, key });
    }

    export async function userExistsWithUsername(
        query: QueryFunc,
        username: string
    ): Promise<boolean> {
        const res = await query<Record<string, number>[]>`
            SELECT 1
            FROM users
            WHERE username = ${username}
        `;
        return res.length === 1;
    }

    export async function newUserIsValid(
        query: QueryFunc,
        username: string,
        password: string
    ): Promise<Result> {
        if (username.length < 3) {
            return Result.err('Username must be at least 3 characters');
        }
        if (password.length < 8) {
            return Result.err('Password must be at least 8 characters');
        }

        if (username.length > 128) {
            return Result.err('Username must be less than 128 characters');
        }

        if (await userExistsWithUsername(query, username)) {
            return Result.err('Username already in use');
        }

        return Result.ok(null);
    }

    export async function create(
        query: QueryFunc,
        username: string,
        password: string
    ): Promise<Result<User>> {
        const { err } = await newUserIsValid(query, username, password);
        if (err) return Result.err(err);

        const salt = await generateSalt(query);
        const id = await UUId.generateUniqueUUId(query);

        await query`
            INSERT INTO users (id, username, password, salt, created)
            VALUES (${id},
                    ${username},
                    SHA2(${password + salt}, 256),
                    ${salt},
                    ${nowUtc()});
        `;

        return Result.ok({ id, username, key: password });
    }

    export async function purge(query: QueryFunc, auth: Auth): Promise<void> {
        await Label.purgeAll(query, auth);
        await Entry.purgeAll(query, auth);
        await Asset.purgeAll(query, auth);
        await Event.purgeAll(query, auth);
        await Settings.purgeAll(query, auth);

        await query`
            DELETE
            FROM users
            WHERE id = ${auth.id}
        `;
    }

    async function generateSalt(query: QueryFunc): Promise<string> {
        let salt = '';
        let existingSalts: { salt: string }[];
        do {
            salt = cryptoRandomStr(10);
            existingSalts = await query<{ salt: string }[]>`
                SELECT salt
                FROM users
                WHERE salt = ${salt}
            `;
        } while (existingSalts.length !== 0);

        return salt;
    }

    export async function changePassword(
        query: QueryFunc,
        auth: Auth,
        oldPassword: string,
        newPassword: string
    ): Promise<Result> {
        if (!oldPassword) return Result.err('Invalid password');

        if (newPassword.length < 5) {
            return Result.err('New password is too short');
        }

        const oldKey = encryptionKeyFromPassword(oldPassword);

        if (oldKey !== auth.key) {
            return Result.err('Current password is invalid');
        }

        if (oldPassword === newPassword) {
            return Result.err('New password is same as current password');
        }

        const newKey = encryptionKeyFromPassword(newPassword);

        const newAuth = {
            ...auth,
            key: newKey
        };

        const { val: backup, err: generateErr } = await Backup.generate(query, auth);
        if (generateErr) return Result.err(generateErr);

        const { err: encryptErr, val: encryptedBackup } = Backup.asEncryptedString(backup, auth);

        if (encryptErr) return Result.err(encryptErr);

        await query`
            UPDATE users
            SET password = SHA2(CONCAT(${newKey}, salt), 256)
            WHERE id = ${auth.id}
        `;

        const { err } = await Backup.restore(query, newAuth, encryptedBackup, auth.key);
        if (err) return Result.err(err);

        return await Settings.changeEncryptionKeyInDB(query, auth, newKey);
    }

    async function getGitHubOAuthAccessToken(code: string, state: string): Promise<Result<string>> {
        if (!state || !code) {
            return Result.err('Invalid state or code');
        }

        let accessTokenRes: Response;
        try {
            accessTokenRes = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                body: JSON.stringify({
                    client_id: PUBLIC_GITHUB_AUTH_CLIENT_ID,
                    client_secret: GITHUB_AUTH_CLIENT_SECRET,
                    code,
                    state
                }),
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                }
            });
        } catch (e) {
            await errorLogger.error(e);
            return Result.err('Error connecting to GitHub');
        }

        let accessTokenData: unknown;
        try {
            accessTokenData = await accessTokenRes.json();
        } catch (e) {
            await errorLogger.error(e);
            await errorLogger.error(await accessTokenRes.text());
            return Result.err('Invalid response from gitHub');
        }

        if (typeof accessTokenData !== 'object' || !accessTokenData) {
            await errorLogger.error(`Invalid response from github`, accessTokenData);
            return Result.err('Invalid response from gitHub');
        }

        if ('error' in accessTokenData && accessTokenData.error) {
            return Result.err(accessTokenData.error.toString());
        }
        if (
            !('token_type' in accessTokenData) ||
            typeof accessTokenData.token_type !== 'string' ||
            accessTokenData.token_type.toLowerCase() !== 'bearer'
        ) {
            await errorLogger.error(`Invalid token type from github`, accessTokenData);
            return Result.err('Invalid response from gitHub');
        }

        if (
            !('access_token' in accessTokenData) ||
            typeof accessTokenData.access_token !== 'string'
        ) {
            await errorLogger.error(`No access token from github`, accessTokenData);
            return Result.err('Invalid response from GitHub');
        }

        return Result.ok(accessTokenData.access_token);
    }

    async function saveGitHubOAuthAccessToken(
        query: QueryFunc,
        auth: Auth,
        accessToken: string
    ): Promise<Result> {
        if (!accessToken) {
            return Result.err('Invalid access token');
        }
        const { err, val } = encrypt(accessToken, auth.key);
        if (err) return Result.err(err);

        await query`
            UPDATE users
            SET ghAccessToken = ${val}
            WHERE id = ${auth.id}
        `;
        return Result.ok(null);
    }

    export async function linkToGitHubOAuth(
        query: QueryFunc,
        auth: Auth,
        code: string,
        state: string
    ): Promise<Result<string>> {
        const { err, val: accessToken } = await getGitHubOAuthAccessToken(code, state);
        if (err) return Result.err(err);

        const { err: saveErr } = await saveGitHubOAuthAccessToken(query, auth, accessToken);
        if (saveErr) return Result.err(saveErr);

        return Result.ok(accessToken);
    }
}

export const User = UserUtils;
