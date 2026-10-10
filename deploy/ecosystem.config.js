// pm2 process file for the droplet: `pm2 start deploy/ecosystem.config.js` from the repo root (see deploy/DEPLOY.md).
// ONE instance only: server.js also runs the mail / sheet outbox worker and the in-memory content cache, and two
// copies would send the same e-mail twice. Secrets stay in .env (server.js loads it); nothing secret here.
module.exports = {
  apps: [{
    name: 'dfresh',
    script: 'server.js',
    cwd: __dirname.replace(/[\\/]deploy$/, ''),
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '350M', // 1 GB droplet shared with MySQL and the other dApps
    kill_timeout: 8000,
    restart_delay: 3000,
    max_restarts: 20,
    time: true,
    out_file: '/var/log/dfresh/out.log',
    error_file: '/var/log/dfresh/error.log',
  }],
};
