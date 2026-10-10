// React dev server, always on port 3000. When 3000 is busy it stops with the PID holding it and the command
// that frees it, instead of moving to 3001 (a second dev server nobody notices). CRA reads PORT from .env,
// where PORT is the API port (4012), and CRA never overrides a variable that is already set, so pinning the
// web port here keeps the two servers apart. CRA's own "use another port?" prompt is never reached.
const net = require('net');
const { busyMessage } = require('../config/ports');

const WEB_PORT = 3000;

// Busy if anything accepts a connection on it, or if we cannot bind it ourselves.
function canConnect(port, host) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.setTimeout(300);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

async function isFree(port) {
  if ((await canConnect(port, '127.0.0.1')) || (await canConnect(port, '::1'))) return false;
  return canBind(port);
}

async function main() {
  if (!(await isFree(WEB_PORT))) {
    busyMessage(WEB_PORT, 'React dev server').forEach((l) => console.error(l));
    process.exit(1);
  }
  process.env.PORT = String(WEB_PORT);
  require('react-scripts/scripts/start');
}

main();
