import { COOKIE_KEYS } from '$lib/constants';
import { PageLoadLog } from '$lib/controllers/log/log.server';
import { sessionCookieOptions } from '$lib/utils/cookies';
import { nowUtc } from '$lib/utils/time';
import type { Cookies, Handle, RequestEvent } from '@sveltejs/kit';
import chalk from 'chalk';
import { connect, dbConnection } from '$lib/db/mysql.server';
import { cleanupCache } from '$lib/utils/cache.server';
import { errorLogger, FileLogger } from '$lib/utils/log.server';
import { Auth } from '$lib/controllers/auth/auth.server';

const reqLogger = new FileLogger('REQ', chalk.bgWhite.black);

// keep connection to database alive
// so it's not re-connected on API request
setInterval(() => {
    try {
        if (!dbConnection) {
            void connect();
            return;
        }
        void dbConnection?.ping().catch(e => errorLogger.error(e));
    } catch (e) {
        void errorLogger.log('Failed to ping db', e);
    }
}, 1000 * 60);

setInterval(() => {
    try {
        cleanupCache();
    } catch (e) {
        void errorLogger.log('Failed to cleanup cache', e);
    }
}, 1000 * 60);

process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);
process.on('uncaughtException', exitHandler);

function exitHandler(...args: unknown[]) {
    void errorLogger.log(`Exited!`, ...args).then(() => {
        process.exit();
    });
}

function getIp(req: RequestEvent): string {
    let ip = '';

    // might be set by the apache reverse proxy
    const xForwardHeader = req.request.headers.get('x-forwarded-for');
    if (xForwardHeader) ip = xForwardHeader;

    const cfConnectingIpHeader = req.request.headers.get('cf-connecting-ip');
    if (!ip && cfConnectingIpHeader) ip = cfConnectingIpHeader;

    if (!ip) {
        try {
            ip = req.getClientAddress();
        } catch (e) {
            ip = '[unknown]';
        }
    }

    return ip || '[unknown]';
}

async function logReq(
    responseTimeMs: Milliseconds,
    created: TimestampSecs,
    req: RequestEvent,
    res: Response,
    auth: Auth | null
): Promise<void> {
    const route = req.route.id || '[unknown]';

    void reqLogger.log(
        req.request.method,
        req.url.href,
        '=>',
        res.status,
        ` ${responseTimeMs.toPrecision(3)}ms`
    );

    const userId = (auth?.id || '').toString();

    const ipAddress = getIp(req);

    await PageLoadLog.createLog({
        created,
        method: req.request.method,
        url: req.url.href,
        route,
        responseTimeMs,
        responseCode: res.status,
        userId,
        userAgent: req.request.headers.get('user-agent') || '',
        requestSize: (await req.request.text()).length,
        resultSize: (await res.text()).length,
        ipAddress
    });
}

function getCookieWritableCookies(cookies: Cookies): App.Locals['__cookieWritables'] {
    const result = {} as Mutable<App.Locals['__cookieWritables']>;

    const cookieKeys = COOKIE_KEYS;
    const keyToNameMap = Object.fromEntries(
        (Object.keys(cookieKeys) as (keyof typeof cookieKeys)[]).map(key => [cookieKeys[key], key])
    );

    for (const { name, value } of cookies.getAll()) {
        if (name in keyToNameMap) {
            result[keyToNameMap[name]] = value;
        }
    }

    delete result.sessionId;

    return result as App.Locals['__cookieWritables'];
}

export const handle = (async ({ event, resolve }) => {
    const start = performance.now();
    const now = nowUtc();

    const auth = Auth.Server.tryGetAuthFromCookies(event.cookies);
    if (auth) {
        event.locals.auth = { ...auth };
    } else {
        event.locals.auth = null;

        // unset session cookie if invalid session
        event.cookies.delete(COOKIE_KEYS.sessionId, sessionCookieOptions(false));
    }

    event.locals.__cookieWritables = getCookieWritableCookies(event.cookies);

    const eventClone: RequestEvent = {
        ...event,
        request: event.request.clone()
    };

    let result: Response;
    try {
        result = await resolve(event);
    } catch (e) {
        void errorLogger.error(e);
        result = new Response('An Error has Occurred', {
            status: 500
        });
    }

    void logReq(performance.now() - start, now, eventClone, result.clone(), auth).catch(
        (...args: unknown[]) => void errorLogger.error(...args)
    );

    return result;
}) satisfies Handle;
