// Who holds a TCP port (used by server.js and scripts/start-web.js on EADDRINUSE, and by `npm run stop`).
// Windows: netstat -ano + tasklist. Linux / macOS: lsof, else ss. Returns [] when nothing listens or the
// tools are missing; never throws.
const { execSync } = require('child_process');

const isWin = process.platform === 'win32';
const run = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch {
    return '';
  }
};

function processName(pid) {
  if (isWin) {
    const m = /^"([^"]+)"/.exec(run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).trim());
    return m ? m[1] : '';
  }
  return run(`ps -o comm= -p ${pid}`).trim();
}

/** [{ pid, name }] of the processes listening on port (IPv4 or IPv6). */
function portOwners(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0) return [];
  const pids = new Set();
  if (isWin) {
    for (const line of run('netstat -ano').split(/\r?\n/)) {
      const f = line.trim().split(/\s+/);
      // TCP  0.0.0.0:4012  0.0.0.0:0  LISTENING  1234   (also [::]:4012)
      if (f[0] === 'TCP' && f[3] === 'LISTENING' && f[1].endsWith(`:${p}`) && Number(f[4]) > 0) pids.add(Number(f[4]));
    }
  } else {
    const lsof = run(`lsof -nP -iTCP:${p} -sTCP:LISTEN -t`);
    if (lsof.trim()) lsof.split(/\s+/).filter(Boolean).forEach((pid) => pids.add(Number(pid)));
    else for (const m of run(`ss -ltnpH "sport = :${p}"`).matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
  }
  return [...pids].map((pid) => ({ pid, name: processName(pid) }));
}

/** The exact command that frees a PID on this OS. */
const killCommand = (pid) => (isWin ? `taskkill /PID ${pid} /F` : `kill ${pid}`);

/** Lines for a "port is busy" message: who holds it and how to free it. */
function busyMessage(port, what) {
  const owners = portOwners(port);
  if (!owners.length) {
    return [`${what}: port ${port} is already in use (could not find the process holding it).`,
      '  Free it with: npm run stop'];
  }
  return [
    `${what}: port ${port} is already in use by ${owners.map((o) => `PID ${o.pid}${o.name ? ` (${o.name})` : ''}`).join(', ')}.`,
    ...owners.map((o) => `  Free it with: ${killCommand(o.pid)}`),
    '  or stop every dFresh dev server with: npm run stop',
  ];
}

module.exports = { portOwners, killCommand, busyMessage, isWin };
