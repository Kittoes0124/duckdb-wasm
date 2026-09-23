import { AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger, DuckDBBundle, LogLevel } from '../src/';

// HTTP secrets through the httpfs extension, read back from the test server's /echo/ endpoint (karma.base.cjs), which
// answers with the Authorization header each request carried. Each test gets its own database: switching to the
// httpfs extension applies to the whole database, and the other suites run on the built-in HTTP reader.
export function testHTTPSecrets(baseURL: string, bundle: () => DuckDBBundle): void {
    const logger = new ConsoleLogger(LogLevel.ERROR);
    const echoScope = `${baseURL}/echo/`;
    const echoURL = `${echoScope}authorization.csv`;

    let db: AsyncDuckDB;
    let conn: AsyncDuckDBConnection;

    const authorizationSent = async (url: string) => {
        const result = await conn.query(`SELECT sent FROM read_csv('${url}', header = true, all_varchar = true)`);
        return result.getChildAt(0)?.get(0) ?? '';
    };

    beforeEach(async () => {
        db = new AsyncDuckDB(logger, new Worker(bundle().mainWorker!));
        await db.instantiate(bundle().mainModule, bundle().pthreadWorker);
        conn = await db.connect();
        await conn.query('SET builtin_httpfs = false; LOAD httpfs;');
    });

    afterEach(async () => {
        await conn.close();
        await db.terminate();
    });

    describe('HTTP secrets', () => {
        it('send a BEARER_TOKEN as an Authorization header', async () => {
            await conn.query(`CREATE SECRET echo (TYPE http, BEARER_TOKEN 'token-from-secret', SCOPE '${echoScope}')`);
            expect(await authorizationSent(echoURL)).toEqual('Bearer token-from-secret');
        });

        it('let an explicit Authorization header take precedence over BEARER_TOKEN', async () => {
            await conn.query(
                `CREATE SECRET echo (TYPE http, BEARER_TOKEN 'token-from-secret', EXTRA_HTTP_HEADERS MAP {'Authorization': 'Basic ZXhwbGljaXQ='}, SCOPE '${echoScope}')`,
            );
            expect(await authorizationSent(echoURL)).toEqual('Basic ZXhwbGljaXQ=');
        });

        it('send nothing outside the secret scope', async () => {
            await conn.query(
                `CREATE SECRET echo (TYPE http, BEARER_TOKEN 'token-from-secret', SCOPE '${baseURL}/elsewhere/')`,
            );
            expect(await authorizationSent(echoURL)).toEqual('');
        });
    });
}
