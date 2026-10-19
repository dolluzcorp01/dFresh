// pm2 process file for the droplet: `pm2 start deploy/ecosystem.config.js` from the repo root (see deploy/DEPLOY.md).
// ONE instance only: server.js also runs the mail / sheet outbox worker and the in-memory content cache, and two
// copies would send the same e-mail twice. Secrets stay in .env (server.js loads it); nothing secret here.
module.exports = {
  apps: [{
    name: 'dfresh-api',
    script: 'server.js',
    // dFresh's own Node 22 (Express 5, sharp); the droplet's system node v18 stays for the other apps. Also pass
    // --interpreter on `pm2 start` (deploy/DEPLOY.md): pm2 then keeps it in its saved list for restarts and reboots.
    interpreter: '/opt/node22/bin/node',
    cwd: __dirname.replace(/[\\/]deploy$/, ''),
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '350M', // 1 GB droplet shared with MySQL and 14 other pm2 apps
    kill_timeout: 8000,
    restart_delay: 3000,
    max_restarts: 20,
    time: true,
    out_file: '/var/log/dfresh/out.log',
    error_file: '/var/log/dfresh/error.log',
  }],
};
