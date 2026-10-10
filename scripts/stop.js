// `npm run stop`: frees the dev ports - the API (PORT in .env, 4012) and the React dev server (3000) - by
// stopping whatever listens on them, and prints what it stopped. Windows: taskkill /F /T (the listener and its
// children). Linux / macOS: SIGTERM, then SIGKILL after 3 s if it is still there.
require('dotenv').config({ quiet: true });
const { execSync } = require('child_process');
const { portOwners, isWin } = require('../config/ports');

const PORTS = [[Number(process.env.PORT) || 4012, 'api'], [3000, 'web']];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kill(pid) {
  if (isWin) {
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore', windowsHide: true });
      return true;
    } catch {
      return !alive(pid);
    }
  }
  try { process.kill(pid, 'SIGTERM'); } catch { return !alive(pid); }
  for (let i = 0; i < 30 && alive(pid); i += 1) await sleep(100);
  if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return !alive(pid);
}

async function main() {
  const stopped = [];
  let failed = false;
  for (const [port, what] of PORTS) {
    const owners = portOwners(port).filter((o) => o.pid !== process.pid);
    if (!owners.length) {
      console.log(`${what} ${port}: nothing listening`);
      continue;
    }
    for (const o of owners) {
      const label = `PID ${o.pid}${o.name ? ` ${o.name}` : ''}`;
      if (await kill(o.pid)) {
        console.log(`${what} ${port}: stopped ${label}`);
        stopped.push(`${what} ${port} (${label})`);
      } else {
        console.error(`${what} ${port}: could not stop ${label} - try it by hand or as administrator`);
        failed = true;
      }
    }
  }
  console.log(stopped.length ? `Stopped: ${stopped.join(', ')}` : 'Stopped: nothing was running');
  if (failed) process.exit(1);
}

main();
