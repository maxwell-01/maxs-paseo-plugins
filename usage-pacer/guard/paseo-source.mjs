import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';

const [cli, home] = process.argv.slice(2);
const require = createRequire(realpathSync(cli));
const control = await import(require.resolve('@getpaseo/server/daemon-control'));
const { createPaseoClient } = await import(require.resolve('@getpaseo/client'));
const { WebSocket } = require('ws');
const instance = await control.readDaemonInstance(home);
if (!instance?.listen) throw new Error('Local daemon endpoint unavailable');
const listen = instance.listen.replace(/^0\.0\.0\.0:/, '127.0.0.1:');
const socketPath = listen.startsWith('/') ? listen : undefined;
const client = createPaseoClient({
  url: socketPath ? `ws+unix://${socketPath}:/ws` : `ws://${listen}/ws`,
  localCredential: () => control.readLocalCredentialForTarget(home, listen),
  connectTimeoutMs: 10000,
  reconnect: { enabled: false },
  webSocketFactory: (url, options) => new WebSocket(url, options?.protocols, {
    headers: options?.headers, ...(socketPath ? { socketPath } : {}),
  }),
});
const timer = setTimeout(() => process.exit(1), 30000);
try {
  await client.connect();
  const [usage, config] = await Promise.all([client.providers.listUsage(), client.config.get()]);
  const agents = [];
  let cursor;
  do {
    const page = await client.agents.list({ includeArchived: false, cursor });
    for (const { agent } of page.entries) agents.push({
      id: agent.id, provider: agent.provider, status: agent.status,
      labels: agent.labels, parentAgentId: agent.parentAgentId ?? agent.labels?.['paseo.parent-agent-id'],
      archivedAt: agent.archivedAt, createdAt: agent.createdAt,
      pendingPermissionCount: agent.pendingPermissions.length,
    });
    cursor = page.pageInfo.nextCursor;
    if (page.pageInfo.hasMore && !cursor) throw new Error('Incomplete agent directory');
  } while (cursor);
  const bases = Object.fromEntries(Object.entries(config.config.providers ?? {})
    .filter(([, value]) => typeof value.extends === 'string')
    .map(([id, value]) => [id, value.extends]));
  console.log(JSON.stringify({
    fetchedAt: usage.fetchedAt,
    providers: usage.providers.filter(p => ['claude', 'codex'].includes(p.providerId)).map(p => ({
      providerId: p.providerId, status: p.status, windows: p.windows.map(w => ({
        id: p.providerId === 'codex' && w.id === 'session' ? 'weekly' : w.id,
        usedPct: w.usedPct, resetsAt: w.resetsAt,
      })),
    })), agents, bases,
  }));
} catch {
  console.error('Paseo usage/agent snapshot failed; gate must remain closed');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await client.close();
}
