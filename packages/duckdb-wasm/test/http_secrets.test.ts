import { AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger, DuckDBBundle, LogLevel } from '../src/';

export function testHTTPSecrets(baseURL: string, bundle: () => DuckDBBundle): void {
    const logger = new ConsoleLogger(LogLevel.ERROR);
    const echoScope = `${baseURL}/echo/`;
    const echoURL = `${echoScope}authorization.csv`;

    describe('HTTP Secrets', () => {
        let db: AsyncDuckDB | undefined;
        let conn: AsyncDuckDBConnection | undefined;

        // Each test uses its own database, since loading httpfs affects the whole database.
        beforeEach(async () => {
            db = new AsyncDuckDB(logger, new Worker(bundle().mainWorker!));
            await db.instantiate(bundle().mainModule, bundle().pthreadWorker);
            conn = await db.connect();
        });

        afterEach(async () => {
            await conn?.close();
            await db?.terminate();
        });

        const loadHttpfs = async () => {
            try {
                await conn!.query('SET builtin_httpfs = false; LOAD httpfs;');
            } catch (e) {
                if (String(e).includes('dynamic linking not enabled')) {
                    pending('httpfs can only be loaded by the loadable builds');
                }
                throw e;
            }
        };

        const authorizationSent = async (url: string) => {
            const result = await conn!.query(`SELECT sent FROM read_csv('${url}', header = true, all_varchar = true)`);
            return result.getChildAt(0)?.get(0) ?? '';
        };

        it('can send bearer token from http secret', async () => {
            await loadHttpfs();
            await conn!.query(`CREATE SECRET echo (TYPE http, BEARER_TOKEN 'token-from-secret', SCOPE '${echoScope}')`);
            expect(await authorizationSent(echoURL)).toEqual('Bearer token-from-secret');
        });

        it('can override bearer token with explicit Authorization header', async () => {
            await loadHttpfs();
            await conn!.query(
                `CREATE SECRET echo (TYPE http, BEARER_TOKEN 'token-from-secret', EXTRA_HTTP_HEADERS MAP {'Authorization': 'Basic ZXhwbGljaXQ='}, SCOPE '${echoScope}')`,
            );
            expect(await authorizationSent(echoURL)).toEqual('Basic ZXhwbGljaXQ=');
        });

        it('does not send bearer token outside of secret scope', async () => {
            await loadHttpfs();
            await conn!.query(
                `CREATE SECRET echo (TYPE http, BEARER_TOKEN 'token-from-secret', SCOPE '${baseURL}/elsewhere/')`,
            );
            expect(await authorizationSent(echoURL)).toEqual('');
        });
    });
}
