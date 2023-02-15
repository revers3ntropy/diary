import mysql from 'mysql2/promise';
import { DB_HOST, DB_USER, DB_PASS, DB, DB_PORT } from '$env/static/private';
import '../require';

export type queryRes =
    | mysql.RowDataPacket[][]
    | mysql.RowDataPacket[]
    | mysql.OkPacket
    | mysql.OkPacket[]
    | mysql.ResultSetHeader
    | Record<string, any>[];

// define defaults from .env file
const port = DB_PORT ? parseInt(DB_PORT) : 3306;
const config: mysql.ConnectionOptions = {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB,
    port
};

let con: mysql.Connection | null = null;

async function connect () {
    console.log(`Connecting to mysql db '${ DB }'...`);
    con = await mysql.createConnection(config).catch((e: any) => {
        console.log(`Error connecting to mysql db '${ DB }'`);
        console.log(e);
        throw e;
    });
}

setInterval(async () => {
    if (!con) await connect();
    con?.ping();
}, 1000 * 60 * 5);

export async function query<Res extends queryRes = mysql.RowDataPacket[]> (
    queryParts: TemplateStringsArray,
    ...params: any[]
): Promise<Res> {

    if (!con) await connect();

    const query = queryParts.reduce((acc, cur, i) => {
        const str = acc + cur;
        if (params[i] === undefined) {
            return str;
        } else if (Array.isArray(params[i])) {
            // so you have ?,?,...?,? in your query for each array element
            return str + "?,".repeat(params[i].length - 1) + "?";
        } else {
            return str + "?";
        }
    }, "");

    // logs query but without whitespace
    // const queryToLog = con?.escape(queryParts)
    // 	.replace(/\s+/g, ' ')
    // 	.replace('\\n', '')
    // 	.replace('\n', '');
    // console.log(`QUERY: ${queryToLog} ${JSON.stringify(params)}`);

    // if it's an array, add all the elements of the array in place as params
    // Flatten 2D arrays
    for (let i = 0; i < params.length; i++) {
        if (Array.isArray(params[i])) {
            // insert the contents of the sub array into the array at it's index
            params.splice(i, 1, ...params[i]);
        }
    }

    console.log(`[QUERY] ${ query } ${ JSON.stringify(params) }`);

    return <Res>(await con?.query(query, params) || [])[0];
}
