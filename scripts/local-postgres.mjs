// Runs PostgreSQL without Docker for local development.
// Credentials and port match docker-compose.yml, so .env works with either.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PGPORT ?? 5433);
const databaseDir = fileURLToPath(new URL('../.pgdata', import.meta.url));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'neonadda',
  password: 'neonadda',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

const firstRun = !existsSync(databaseDir);
if (firstRun) await pg.initialise();
await pg.start();
if (firstRun) await pg.createDatabase('neonadda');

console.log(`PostgreSQL listening on localhost:${port}, database "neonadda". Press Ctrl+C to stop.`);

async function shutdown() {
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
