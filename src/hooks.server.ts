import type { Handle, RequestEvent } from '@sveltejs/kit';
import chalk from 'chalk';
import { connect, dbConnection } from './lib/db/mysql';
import { cleanupCache } from './lib/utils/cache';
import { makeLogger } from './lib/utils/log';

export const errorLogger = makeLogger('ERR', chalk.red, 'general.log');
const reqLogger = makeLogger('REQ', chalk.grey, 'general.log');

// keep connection to database alive
// so it's not re-connected on API request
setInterval(async () => {
    if (!dbConnection) await connect();
    dbConnection?.ping();
}, 1000 * 60);

setInterval(cleanupCache, 1000 * 60);

async function exitHandler (code: number) {
    await errorLogger.logToFile(`Exited with code ${code}`);
    process.exit();
}

process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);
process.on('SIGTERM', exitHandler);
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);
process.on('uncaughtException', exitHandler);

function logReq (time: number, event: RequestEvent) {
    const path = new URL(event.request.url).pathname.split('/');
    path.shift();
    let pathStr = '/' + path.shift();
    if (pathStr === '/api') {
        pathStr += '/' + path.shift();
    }
    if (path.length) {
        pathStr += `/[...${path.join('/').length}]`;
    }

    reqLogger.logToFile(
        event.request.method,
        `(${time.toPrecision(3)}ms)`,
        pathStr,
    );
}

export const handle = (async ({ event, resolve }) => {
    const start = performance.now();
    let result: Response;
    try {
        result = await resolve(event);
    } catch (e) {
        errorLogger.logToFile(e);
        result = new Response('An Error has Occurred', {
            status: 500,
        });
    }
    const end = performance.now();
    logReq(end - start, event);

    return result;
}) satisfies Handle;

