import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

/** Explicit opt-in for machines with native PostgreSQL 17 instead of Docker. */
export function nativeTestDatabase(bin) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key];
  env.PGHOSTADDR = '127.0.0.1';
  env.PGSSLMODE = 'disable';
  env.PGPASSFILE = '/dev/null';
  const call = (name, args) => execFileSync(path.join(bin, name), args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  if (!/^postgres \(PostgreSQL\) 17\./.test(call('postgres', ['--version']))) throw new Error('Native test provider requires PostgreSQL 17.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'siskop-prepush-pg-'));
  const data = path.join(directory, 'data');
  let mayBeRunning = false;
  const handlers = new Map();
  const close = () => {
    if (mayBeRunning && spawnSync(path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { env, stdio: 'ignore' }).status === 0) {
      call('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    }
    mayBeRunning = false;
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => { close(); process.exit(code); };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    const port = execFileSync(process.execPath, ['--input-type=module', '-e',
      "import net from 'node:net'; const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});"], { encoding: 'utf8' }).trim();
    if (!/^\d+$/.test(port)) throw new Error('Could not allocate local PostgreSQL test port.');
    call('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8']);
    mayBeRunning = true;
    call('pg_ctl', ['-D', data, '-l', path.join(directory, 'server.log'), '-w', 'start', '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=`]);
    call('createdb', ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', 'siskop_prepush_test']);
    return { close, url: `postgresql://postgres@127.0.0.1:${port}/siskop_prepush_test` };
  } catch (error) { close(); throw error; }
}
