// React dev server on 3000, or the next free port (3001, 3002 ...) when 3000 is busy (Inside D pattern).
// CRA reads PORT from .env, where PORT is the API port (4012), and CRA never overrides a variable that is
// already set, so pinning the web port here keeps the two servers apart. The port is picked here, not by
// CRA's "use another port?" prompt, because that prompt exits when there is no terminal (npm run dev).
const net = require('net');

const FIRST = Number(process.env.WEB_PORT) || 3000;
const API_PORT = 4012; // never hand the API's port to React
const TRIES = 20;

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
  if (port === API_PORT) return false;
  if ((await canConnect(port, '127.0.0.1')) || (await canConnect(port, '::1'))) return false;
  return canBind(port);
}

async function main() {
  for (let port = FIRST; port < FIRST + TRIES; port += 1) {
    if (await isFree(port)) {
      if (port !== FIRST) console.log(`Port ${FIRST} is busy, starting React on ${port}.`);
      process.env.PORT = String(port);
      require('react-scripts/scripts/start');
      return;
    }
  }
  console.error(`No free port between ${FIRST} and ${FIRST + TRIES - 1}.`);
  process.exit(1);
}

main();
