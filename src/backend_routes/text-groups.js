// Translations groups with special handling on the server.
// STAFF_GROUP: words of the staff e-mails (mailer.js). Read in the default language only, never sent to the public
// site (Public_server.js bootstrap), and not counted as missing translations (admin-entities.js completeness,
// Translations screen).
const STAFF_GROUP = 'Staff e-mails';

// RETIRED_KEYS: texts the site no longer shows. Their rows stay in the database (no migration), but the admin hides
// them: not on the Translations page, not in its CSV / Excel export or the Product List's UI_Text sheet, not counted
// as missing, and a CSV row for one is skipped on import.
//   touch - the "Touch it, or pick it up anywhere" pill under the home hero tissue (removed 20 Oct 2026)
const RETIRED_KEYS = ['touch'];

module.exports = { STAFF_GROUP, RETIRED_KEYS };
