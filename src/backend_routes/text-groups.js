// Translations groups with special handling on the server.
// STAFF_GROUP: words of the staff e-mails (mailer.js). Read in the default language only, never sent to the public
// site (Public_server.js bootstrap), and not counted as missing translations (admin-entities.js completeness,
// Translations screen).
const STAFF_GROUP = 'Staff e-mails';

module.exports = { STAFF_GROUP };
