// Outbox processors (spec D2 step 5), started by server.js: every 15 s, send due mail_outbox rows (mailer.js)
// and sync due sync_outbox rows (gsheet.js).
// - Single flight: a tick never starts while the previous one runs. Each row is also claimed with a guarded
//   UPDATE (pending -> sending), so a second server process could never send it twice.
// - Failure: attempts + 1, next try after 1, 5, 15, then 60 minutes; after 8 attempts the row is 'failed'
//   (visible in the admin, retry from there).
// - Disabled (MAIL_ENABLED / GSHEET_ENABLED not true, or not ready): rows stay 'pending'; the reason is
//   logged once until it changes.
// - A row left in 'sending' by a crash is released back to 'pending' after 10 minutes.
// - Sign-in codes (purpose 'admin_otp') are wiped from the row once sent: the outbox must not keep a code.
//   One still pending after the code's 10 minutes is cancelled and wiped instead (a late code is useless).
// - A row whose lead no longer exists is never sent: every pass marks such pending rows 'cancelled', and each
//   row is checked again right after it is claimed. (Both outboxes cascade-delete with their lead, so this
//   only catches rows written with foreign keys off, e.g. a restore, or a lead deleted mid-pass.)
const { getDBConnection } = require('../../config/db');
const mailer = require('./mailer');
const gsheet = require('./gsheet');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

const INTERVAL_MS = 15 * 1000;
const BACKOFF_MIN = [1, 5, 15, 60];
const MAX_ATTEMPTS = 8;
const BATCH = 10;
const STUCK_MIN = 10;

const OUTBOXES = {
  mail: {
    table: 'mail_outbox', id: 'mail_id', doneStatus: 'sent', doneAt: 'sent_at',
    cols: 'mail_id, lead_id, purpose, to_email, subject, html_body, text_body',
    ready: async () => mailer.readiness(),
    cleanup: () => db.query(
      `UPDATE mail_outbox SET status = 'cancelled', subject = 'dFresh admin sign-in code (expired, removed)',
              html_body = '-', text_body = '-', last_error = 'sign-in code expired before it was sent'
        WHERE purpose = 'admin_otp' AND status = 'pending' AND created_at < NOW() - INTERVAL 10 MINUTE`
    ),
    run: (r) => mailer.send({ to: r.to_email, subject: r.subject, html: r.html_body, text: r.text_body }),
    doneCols: (sent, r) => ({
      provider_msg_id: sent.providerId,
      ...(r.purpose === 'admin_otp' ? { subject: 'dFresh admin sign-in code (removed after sending)', html_body: '-', text_body: '-' } : {}),
    }),
  },
  sync: {
    table: 'sync_outbox', id: 'sync_id', doneStatus: 'done', doneAt: 'done_at',
    cols: 'sync_id, lead_id',
    ready: () => gsheet.readiness(),
    run: async (r) => {
      await gsheet.appendLead(r.lead_id);
      await db.query('UPDATE leads SET sheet_synced_at = NOW() WHERE lead_id = ?', [r.lead_id]);
    },
  },
};

const lastReason = {}; // outbox -> last logged "not ready" reason
let running = false;
let timer = null;

const leadGone = (leadId) => `lead ${leadId} no longer exists`;

async function cancelOrphans(table) {
  const [r] = await db.query(
    `UPDATE ${table} o LEFT JOIN leads l ON l.lead_id = o.lead_id
        SET o.status = 'cancelled', o.last_error = CONCAT('lead ', o.lead_id, ' no longer exists')
      WHERE o.status = 'pending' AND o.lead_id IS NOT NULL AND l.lead_id IS NULL`
  );
  if (r.affectedRows) console.warn(`${table}: ${r.affectedRows} row(s) cancelled, their lead no longer exists`);
}

const backoffMinutes = (attempts) => BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1];

async function processOutbox(name) {
  const o = OUTBOXES[name];
  const { table, id } = o;
  await db.query(
    `UPDATE ${table} SET status = 'pending' WHERE status = 'sending' AND next_attempt_at < NOW() - INTERVAL ? MINUTE`,
    [STUCK_MIN]
  );
  await cancelOrphans(table);
  if (o.cleanup) await o.cleanup();

  const state = await o.ready();
  if (!state.ok) {
    if (lastReason[name] !== state.reason) {
      const [[c]] = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE status = 'pending'`);
      console.log(`${table}: not sending (${state.reason}); ${c.n} pending row(s) stay in the outbox`);
      lastReason[name] = state.reason;
    }
    return { sent: 0, failed: 0, skipped: true };
  }
  if (lastReason[name]) console.log(`${table}: sending enabled`);
  lastReason[name] = null;

  const [due] = await db.query(
    `SELECT ${o.cols}, attempts FROM ${table}
      WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY ${id} LIMIT ?`,
    [BATCH]
  );
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    // next_attempt_at doubles as "claimed at" while sending (for the stuck-row release above)
    const [claim] = await db.query(
      `UPDATE ${table} SET status = 'sending', next_attempt_at = NOW() WHERE ${id} = ? AND status = 'pending'`,
      [row[id]]
    );
    if (claim.affectedRows !== 1) continue;
    if (row.lead_id !== null) {
      const [[lead]] = await db.query('SELECT 1 AS ok FROM leads WHERE lead_id = ?', [row.lead_id]);
      if (!lead) {
        await db.query(`UPDATE ${table} SET status = 'cancelled', last_error = ? WHERE ${id} = ?`, [leadGone(row.lead_id), row[id]]);
        console.warn(`${table} #${row[id]} cancelled: ${leadGone(row.lead_id)}`);
        continue;
      }
    }
    try {
      const result = await o.run(row);
      const extra = o.doneCols ? o.doneCols(result, row) : {};
      await db.query(
        `UPDATE ${table} SET status = ?, ${o.doneAt} = NOW(), attempts = attempts + 1, last_error = NULL${Object.keys(extra).map((c) => `, ${c} = ?`).join('')} WHERE ${id} = ?`,
        [o.doneStatus, ...Object.values(extra), row[id]]
      );
      sent += 1;
    } catch (err) {
      const attempts = Number(row.attempts) + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      const msg = String((err.response && err.response.body && JSON.stringify(err.response.body.errors)) || err.message || err).slice(0, 500);
      await db.query(
        `UPDATE ${table} SET status = ?, attempts = ?, last_error = ?,
                next_attempt_at = NOW() + INTERVAL ? MINUTE WHERE ${id} = ?`,
        [giveUp ? 'failed' : 'pending', attempts, msg, giveUp ? 0 : backoffMinutes(attempts), row[id]]
      );
      console.error(`${table} #${row[id]} attempt ${attempts} failed${giveUp ? ' (gave up)' : ''}: ${msg}`);
      failed += 1;
    }
  }
  return { sent, failed, skipped: false };
}

/** One pass over both outboxes. Returns null when a pass is already running. */
async function tick() {
  if (running) return null;
  running = true;
  try {
    const result = {};
    for (const name of Object.keys(OUTBOXES)) {
      try {
        result[name] = await processOutbox(name);
      } catch (err) {
        console.error(`outbox ${name} pass failed:`, err.code || err.message);
        result[name] = { error: err.code || err.message };
      }
    }
    return result;
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  if (process.env.MAIL_TEST_TO && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: MAIL_TEST_TO is set in production - every e-mail is redirected to it. Remove it from the server .env.');
  }
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  tick();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, backoffMinutes, MAX_ATTEMPTS };
