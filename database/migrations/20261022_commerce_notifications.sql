-- Commerce phase 10 (docs/COMMERCE-SPEC.md 5.5f): notifications. Structure and defaults only (the default templates are
-- defaults); the demo opt-outs, languages and staff addresses come from scripts/commerce-demo-seed.js.
-- - Commerce settings, group Notifications: the channels (e-mail on; WhatsApp and SMS "provider not set up", off and
--   locked), one on / off per customer event, the reminder numbers; group Staff notifications: one per staff event.
-- - notification_templates: subject + body per event and language (rows, so a new language needs rows only), with
--   placeholders like {customer} and {order_no}; Tamil and Hindi defaults are marked needs_review until Dolluz checks.
-- - notification_log: every message (event, recipient, channel, the order / customer / return it belongs to, the mail
--   row it went out as); queued / sent / failed come from that mail row, skipped (with the reason) is kept here.
-- - notification_runs: the daily jobs, once per India day.
-- - customers: language for their mails, opt-out of reminders and of offers (never of invoices).
-- - orders: the contact who gets the delivery messages. admin_users: an address for staff mails other than the dAdmin
--   e-mail (empty = the dAdmin e-mail; Setup > Admin users). mail_outbox: attachments (documents built as PDF when sent).
-- Named 20261022 so it runs after every 20261021 migration (it refers to returns and wallet tables).
USE dfresh;

ALTER TABLE mail_outbox ADD COLUMN attachments VARCHAR(500) NULL AFTER text_body; -- JSON [{"kind":"invoice","id":12}]

ALTER TABLE customers
  ADD COLUMN lang_code VARCHAR(10) NULL AFTER email,                          -- NULL = the default language
  ADD COLUMN opt_out_reminders TINYINT(1) NOT NULL DEFAULT 0 AFTER lang_code, -- no overdue / wallet expiry reminders
  ADD COLUMN opt_out_offers TINYINT(1) NOT NULL DEFAULT 0 AFTER opt_out_reminders;

ALTER TABLE orders ADD COLUMN contact_id INT NULL AFTER ship_address_id;       -- gets the delivery messages

ALTER TABLE admin_users ADD COLUMN notify_email VARCHAR(150) NULL AFTER role_id;

CREATE TABLE IF NOT EXISTS notification_templates (
  event_key     VARCHAR(40)   NOT NULL,
  lang_code     VARCHAR(10)   NOT NULL,
  subject       VARCHAR(200)  NOT NULL,
  body          TEXT          NOT NULL,
  needs_review  TINYINT(1)    NOT NULL DEFAULT 0,  -- a default translation not yet checked by Dolluz
  updated_by    VARCHAR(20)   NULL,
  updated_at    DATETIME      NULL,
  PRIMARY KEY (event_key, lang_code),
  CONSTRAINT fk_ntpl_lang FOREIGN KEY (lang_code) REFERENCES languages (lang_code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_log (
  log_id          BIGINT        NOT NULL AUTO_INCREMENT,
  event_key       VARCHAR(40)   NOT NULL,
  audience        VARCHAR(10)   NOT NULL,              -- customer | staff
  channel         VARCHAR(10)   NOT NULL DEFAULT 'email',
  recipient       VARCHAR(150)  NULL,                  -- the e-mail address
  recipient_name  VARCHAR(150)  NULL,
  emp_id          VARCHAR(20)   NULL,                  -- a staff recipient
  lang_code       VARCHAR(10)   NULL,
  subject         VARCHAR(255)  NULL,
  status          VARCHAR(10)   NOT NULL DEFAULT 'queued', -- queued (see the mail row) | skipped
  skip_reason     VARCHAR(255)  NULL,
  mail_id         BIGINT        NULL,
  customer_id     INT           NULL,
  order_id        BIGINT        NULL,
  return_id       BIGINT        NULL,
  ref             VARCHAR(60)   NULL,                  -- invoice / credit note / approval / trip it is about
  is_test         TINYINT(1)    NOT NULL DEFAULT 0,    -- "Send test to me"
  created_by      VARCHAR(20)   NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (log_id),
  KEY idx_nlog_event (event_key, created_at),
  KEY idx_nlog_customer (customer_id, created_at),
  KEY idx_nlog_order (order_id),
  KEY idx_nlog_mail (mail_id),
  CONSTRAINT fk_nlog_mail FOREIGN KEY (mail_id) REFERENCES mail_outbox (mail_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_runs (
  job_key   VARCHAR(40)   NOT NULL,
  run_day   DATE          NOT NULL,                    -- India date
  ran_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result    VARCHAR(255)  NULL,
  PRIMARY KEY (job_key, run_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- channels (the three rows exist since 20261020_commerce_settings.sql)
UPDATE commerce_settings SET label = 'E-mail', help = 'Every notification below goes out by e-mail through the mail outbox (sender: Settings > mail_from). Off = no notification e-mail at all.' WHERE setting_key = 'notify_email';
UPDATE commerce_settings SET label = 'WhatsApp', help = 'Provider not set up: stays off until a WhatsApp provider is chosen. To be confirmed by sir.' WHERE setting_key = 'notify_whatsapp';
UPDATE commerce_settings SET label = 'SMS', help = 'Provider not set up: stays off until an SMS provider is chosen. To be confirmed by sir.' WHERE setting_key = 'notify_sms';

INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('notify_ev_order_confirmed', 'Notifications', 'Customer: order confirmed', 'When an order is confirmed: at once, or when its last approval is given. An order waiting for approval sends nothing. To the order contact.', '1', 'bool', NULL, 0, 100),
  ('notify_ev_order_packed', 'Notifications', 'Customer: order packed', 'When packing is done. To the order contact.', '1', 'bool', NULL, 0, 110),
  ('notify_ev_order_out', 'Notifications', 'Customer: out for delivery', 'When the trip with the order starts (own vehicle). To the order contact.', '1', 'bool', NULL, 0, 120),
  ('notify_ev_order_courier', 'Notifications', 'Customer: handed to the courier', 'With the AWB number and the tracking link. To the order contact.', '1', 'bool', NULL, 0, 130),
  ('notify_ev_order_delivered', 'Notifications', 'Customer: delivered', 'When the order is delivered (trip, courier or pickup at the godown). To the order contact.', '1', 'bool', NULL, 0, 140),
  ('notify_ev_invoice', 'Notifications', 'Customer: invoice (PDF attached)', 'When the tax invoice is issued. To the contacts with "gets invoices" (else the customer''s e-mail); an opt-out never stops it.', '1', 'bool', NULL, 0, 150),
  ('notify_ev_payment', 'Notifications', 'Customer: payment received (receipt)', 'Every payment recorded on an order, cash on delivery included. To the invoice contacts.', '1', 'bool', NULL, 0, 160),
  ('notify_ev_return_accepted', 'Notifications', 'Customer: return accepted', 'When a return is created inside the window, or approved outside it. To the order contact.', '1', 'bool', NULL, 0, 170),
  ('notify_ev_return_picked', 'Notifications', 'Customer: return picked up', 'When the driver picks the goods up, or they reach the godown (courier, brought in). To the order contact.', '1', 'bool', NULL, 0, 180),
  ('notify_ev_return_refunded', 'Notifications', 'Customer: refunded (credit note PDF attached)', 'When a refund is paid. To the invoice contacts.', '1', 'bool', NULL, 0, 190),
  ('notify_ev_wallet_credited', 'Notifications', 'Customer: wallet credited', 'Cashback and manual credits (a refund to the wallet is in the refund mail). To the customer''s e-mail.', '1', 'bool', NULL, 0, 200),
  ('notify_ev_wallet_expiring', 'Notifications', 'Customer: wallet credit expiring', 'Once per credit, the number of days below before it expires (daily). A reminder: not to customers who opted out of reminders.', '1', 'bool', NULL, 0, 210),
  ('notify_wallet_expiry_days', 'Notifications', 'Wallet expiring: tell this many days before', 'Days before the expiry date.', '7', 'int', NULL, 0, 220),
  ('notify_ev_overdue', 'Notifications', 'Customer: overdue reminder (statement PDF attached)', 'Daily check: a customer with overdue invoices gets a reminder every N days, at most M times (below). To the invoice contacts; not to customers who opted out of reminders.', '1', 'bool', NULL, 0, 230),
  ('notify_overdue_every_days', 'Notifications', 'Overdue reminder: every N days', 'Days between two reminders to the same customer.', '7', 'int', NULL, 0, 240),
  ('notify_overdue_max', 'Notifications', 'Overdue reminder: at most M times', 'Reminders while invoices stay overdue; counted again once everything was paid.', '3', 'int', NULL, 0, 250),
  ('notify_daily_hour', 'Notifications', 'Daily mails at (hour, India time)', 'Overdue reminders, wallet expiry, stock, follow-ups and the daily summary go out once a day from this hour (0 to 23).', '9', 'int', NULL, 0, 260),
  ('notify_ev_approval', 'Staff notifications', 'Approval waiting', 'To the users of the approver roles who may decide it (not the one who asked).', '1', 'bool', NULL, 0, 10),
  ('notify_ev_stock_daily', 'Staff notifications', 'Low stock and near expiry (daily)', 'To the users with "edit" on Inventory, when something is low or near expiry.', '1', 'bool', NULL, 0, 20),
  ('notify_ev_follow_ups', 'Staff notifications', 'Follow-ups due today (daily)', 'To each owner of follow-ups due today or overdue.', '1', 'bool', NULL, 0, 30),
  ('notify_ev_delivery_failed', 'Staff notifications', 'Failed delivery', 'To the users who plan trips ("create" on Delivery).', '1', 'bool', NULL, 0, 40),
  ('notify_ev_cash_difference', 'Staff notifications', 'Cash handover difference', 'When a trip ends with cash handed over different from cash collected. To the users who plan trips.', '1', 'bool', NULL, 0, 50),
  ('notify_ev_daily_summary', 'Staff notifications', 'Daily summary for Admin', 'Yesterday''s orders, sales, payments, deliveries, returns and what waits. To the Admin users.', '1', 'bool', NULL, 0, 60);

-- default templates: English for every event; Tamil and Hindi for the customer events (to be checked: needs_review)
INSERT IGNORE INTO notification_templates (event_key, lang_code, subject, body, needs_review) VALUES
  ('order_confirmed', 'en', 'Order {order_no} confirmed', 'Dear {customer},\n\nThank you for your order {order_no}. We have confirmed it and will pack it soon.\n\nOrder value: Rs {total}\nItems: {items}\nDelivery to: {ship_to}\n\nWe will write again when it leaves our godown.\n\nTeam dFresh', 0),
  ('order_packed', 'en', 'Order {order_no} is packed', 'Dear {customer},\n\nYour order {order_no} is packed ({cartons} carton(s)) and will leave our godown soon.\n\nTeam dFresh', 0),
  ('order_out', 'en', 'Order {order_no} is out for delivery', 'Dear {customer},\n\nYour order {order_no} left our godown today on our own vehicle and will reach you today.\n\nDelivery to: {ship_to}\nBalance to pay: Rs {amount_due}\n\nTeam dFresh', 0),
  ('order_courier', 'en', 'Order {order_no} handed to {courier}', 'Dear {customer},\n\nYour order {order_no} was handed to {courier} today. AWB number: {awb}\n\nTrack it here: {tracking_link}\n\nTeam dFresh', 0),
  ('order_delivered', 'en', 'Order {order_no} delivered', 'Dear {customer},\n\nYour order {order_no} was delivered today to {received_by}. Thank you for choosing dFresh.\n\nAnything wrong with the goods? Reply to this mail within {return_days} days.\n\nTeam dFresh', 0),
  ('invoice', 'en', 'Invoice {invoice_no} for order {order_no}', 'Dear {customer},\n\nPlease find attached our tax invoice {invoice_no} for order {order_no}.\n\nInvoice total: Rs {total}\nDue on: {due_on}\n\nTeam dFresh', 0),
  ('payment', 'en', 'Payment received: Rs {amount} for {order_no}', 'Dear {customer},\n\nWe received your payment. Thank you.\n\nAmount: Rs {amount}\nMode: {mode}\nReference: {reference}\nDate: {paid_on}\nOrder: {order_no}\nBalance due on this order: Rs {amount_due}\n\nPlease keep this mail as your receipt.\n\nTeam dFresh', 0),
  ('return_accepted', 'en', 'Return {return_no} accepted', 'Dear {customer},\n\nWe accepted your return {return_no} for order {order_no}: {items}.\n\nWe will write again when we have the goods.\n\nTeam dFresh', 0),
  ('return_picked', 'en', 'Return {return_no}: goods collected', 'Dear {customer},\n\nWe have the goods of your return {return_no}. We will check them and tell you about the refund.\n\nTeam dFresh', 0),
  ('return_refunded', 'en', 'Refund for return {return_no}: Rs {amount}', 'Dear {customer},\n\nWe have refunded Rs {amount} for your return {return_no}. Our credit note {credit_note_no} is attached.\n\nTeam dFresh', 0),
  ('wallet_credited', 'en', 'Rs {amount} added to your dFresh wallet', 'Dear {customer},\n\nRs {amount} was added to your dFresh wallet: {reason}.\nWallet balance: Rs {balance}\n\nUse it on your next order.\n\nTeam dFresh', 0),
  ('wallet_expiring', 'en', 'Rs {amount} of your wallet expires on {expires_on}', 'Dear {customer},\n\nRs {amount} in your dFresh wallet expires on {expires_on} (in {days} days). Use it on your next order.\nWallet balance: Rs {balance}\n\nTeam dFresh', 0),
  ('overdue', 'en', 'Payment reminder: Rs {overdue_amount} overdue', 'Dear {customer},\n\nOur records show Rs {overdue_amount} overdue on {overdue_count} invoice(s): {invoices}.\n\nTotal outstanding: Rs {outstanding}\n\nYour statement of account is attached. If you have paid already, please ignore this mail and send us the payment reference.\n\nTeam dFresh', 0),

  ('order_confirmed', 'ta', 'ஆர்டர் {order_no} உறுதி செய்யப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no}-க்கு நன்றி. அதை உறுதி செய்துள்ளோம், விரைவில் பேக் செய்வோம்.\n\nஆர்டர் மதிப்பு: Rs {total}\nபொருட்கள்: {items}\nடெலிவரி முகவரி: {ship_to}\n\nஎங்கள் கிடங்கிலிருந்து அனுப்பியதும் மீண்டும் தெரிவிப்போம்.\n\ndFresh குழு', 1),
  ('order_packed', 'ta', 'ஆர்டர் {order_no} பேக் செய்யப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} பேக் செய்யப்பட்டது ({cartons} அட்டைப்பெட்டி). விரைவில் எங்கள் கிடங்கிலிருந்து அனுப்பப்படும்.\n\ndFresh குழு', 1),
  ('order_out', 'ta', 'ஆர்டர் {order_no} டெலிவரிக்கு புறப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} இன்று எங்கள் வாகனத்தில் புறப்பட்டது, இன்றே உங்களை வந்தடையும்.\n\nடெலிவரி முகவரி: {ship_to}\nசெலுத்த வேண்டிய தொகை: Rs {amount_due}\n\ndFresh குழு', 1),
  ('order_courier', 'ta', 'ஆர்டர் {order_no} {courier}-இடம் ஒப்படைக்கப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} இன்று {courier}-இடம் ஒப்படைக்கப்பட்டது. AWB எண்: {awb}\n\nஇங்கே கண்காணிக்கலாம்: {tracking_link}\n\ndFresh குழு', 1),
  ('order_delivered', 'ta', 'ஆர்டர் {order_no} டெலிவரி செய்யப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} இன்று {received_by} அவர்களிடம் டெலிவரி செய்யப்பட்டது. dFresh-ஐ தேர்ந்தெடுத்ததற்கு நன்றி.\n\nபொருட்களில் ஏதேனும் குறை இருந்தால், {return_days} நாட்களுக்குள் இந்த மின்னஞ்சலுக்கு பதில் அனுப்புங்கள்.\n\ndFresh குழு', 1),
  ('invoice', 'ta', 'ஆர்டர் {order_no}-க்கான விலைப்பட்டியல் {invoice_no}', 'அன்புள்ள {customer},\n\nஆர்டர் {order_no}-க்கான எங்கள் வரி விலைப்பட்டியல் {invoice_no} இணைக்கப்பட்டுள்ளது.\n\nவிலைப்பட்டியல் மொத்தம்: Rs {total}\nசெலுத்த வேண்டிய தேதி: {due_on}\n\ndFresh குழு', 1),
  ('payment', 'ta', 'பணம் பெறப்பட்டது: {order_no}-க்கு Rs {amount}', 'அன்புள்ள {customer},\n\nஉங்கள் பணம் பெறப்பட்டது. நன்றி.\n\nதொகை: Rs {amount}\nமுறை: {mode}\nகுறிப்பு எண்: {reference}\nதேதி: {paid_on}\nஆர்டர்: {order_no}\nஇந்த ஆர்டரில் மீதமுள்ள தொகை: Rs {amount_due}\n\nஇந்த மின்னஞ்சலை உங்கள் ரசீதாக வைத்துக்கொள்ளுங்கள்.\n\ndFresh குழு', 1),
  ('return_accepted', 'ta', 'திருப்பி அனுப்புதல் {return_no} ஏற்கப்பட்டது', 'அன்புள்ள {customer},\n\nஆர்டர் {order_no}-க்கான உங்கள் திருப்பி அனுப்புதல் {return_no} ஏற்கப்பட்டது: {items}.\n\nபொருட்களைப் பெற்றதும் மீண்டும் தெரிவிப்போம்.\n\ndFresh குழு', 1),
  ('return_picked', 'ta', 'திருப்பி அனுப்புதல் {return_no}: பொருட்கள் பெறப்பட்டன', 'அன்புள்ள {customer},\n\nஉங்கள் திருப்பி அனுப்புதல் {return_no}-இன் பொருட்களைப் பெற்றுக்கொண்டோம். அவற்றைச் சரிபார்த்து, பணத்தைத் திருப்பித் தருவது பற்றி தெரிவிப்போம்.\n\ndFresh குழு', 1),
  ('return_refunded', 'ta', 'திருப்பி அனுப்புதல் {return_no}-க்கு Rs {amount} திருப்பித் தரப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் திருப்பி அனுப்புதல் {return_no}-க்கு Rs {amount} திருப்பித் தரப்பட்டது. எங்கள் கடன் குறிப்பு {credit_note_no} இணைக்கப்பட்டுள்ளது.\n\ndFresh குழு', 1),
  ('wallet_credited', 'ta', 'உங்கள் dFresh வாலட்டில் Rs {amount} சேர்க்கப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் dFresh வாலட்டில் Rs {amount} சேர்க்கப்பட்டது: {reason}.\nவாலட் இருப்பு: Rs {balance}\n\nஉங்கள் அடுத்த ஆர்டரில் பயன்படுத்துங்கள்.\n\ndFresh குழு', 1),
  ('wallet_expiring', 'ta', 'உங்கள் வாலட்டில் Rs {amount} {expires_on} அன்று காலாவதியாகும்', 'அன்புள்ள {customer},\n\nஉங்கள் dFresh வாலட்டில் உள்ள Rs {amount} {expires_on} அன்று ({days} நாட்களில்) காலாவதியாகும். உங்கள் அடுத்த ஆர்டரில் பயன்படுத்துங்கள்.\nவாலட் இருப்பு: Rs {balance}\n\ndFresh குழு', 1),
  ('overdue', 'ta', 'பணம் செலுத்த நினைவூட்டல்: Rs {overdue_amount} நிலுவையில் உள்ளது', 'அன்புள்ள {customer},\n\nஎங்கள் பதிவுகளின்படி {overdue_count} விலைப்பட்டியல்களில் Rs {overdue_amount} செலுத்தும் தேதி கடந்து நிலுவையில் உள்ளது: {invoices}.\n\nமொத்த நிலுவை: Rs {outstanding}\n\nஉங்கள் கணக்கு அறிக்கை இணைக்கப்பட்டுள்ளது. ஏற்கனவே செலுத்தியிருந்தால், இந்த மின்னஞ்சலைப் புறக்கணித்து, பணம் செலுத்திய குறிப்பு எண்ணை எங்களுக்கு அனுப்புங்கள்.\n\ndFresh குழு', 1),

  ('order_confirmed', 'hi', 'ऑर्डर {order_no} की पुष्टि हो गई', 'प्रिय {customer},\n\nआपके ऑर्डर {order_no} के लिए धन्यवाद। हमने इसकी पुष्टि कर दी है और जल्द ही इसे पैक करेंगे।\n\nऑर्डर मूल्य: Rs {total}\nसामान: {items}\nडिलीवरी पता: {ship_to}\n\nगोदाम से निकलते ही हम फिर से सूचित करेंगे।\n\nटीम dFresh', 1),
  ('order_packed', 'hi', 'ऑर्डर {order_no} पैक हो गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} पैक हो गया है ({cartons} कार्टन) और जल्द ही हमारे गोदाम से निकलेगा।\n\nटीम dFresh', 1),
  ('order_out', 'hi', 'ऑर्डर {order_no} डिलीवरी के लिए निकल गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} आज हमारे वाहन से निकल गया है और आज ही आप तक पहुँचेगा।\n\nडिलीवरी पता: {ship_to}\nदेय राशि: Rs {amount_due}\n\nटीम dFresh', 1),
  ('order_courier', 'hi', 'ऑर्डर {order_no} {courier} को सौंपा गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} आज {courier} को सौंपा गया। AWB नंबर: {awb}\n\nयहाँ ट्रैक करें: {tracking_link}\n\nटीम dFresh', 1),
  ('order_delivered', 'hi', 'ऑर्डर {order_no} डिलीवर हो गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} आज {received_by} को डिलीवर किया गया। dFresh चुनने के लिए धन्यवाद।\n\nसामान में कोई कमी हो तो {return_days} दिनों के भीतर इस मेल का जवाब दें।\n\nटीम dFresh', 1),
  ('invoice', 'hi', 'ऑर्डर {order_no} का इनवॉइस {invoice_no}', 'प्रिय {customer},\n\nऑर्डर {order_no} का हमारा टैक्स इनवॉइस {invoice_no} संलग्न है।\n\nइनवॉइस कुल: Rs {total}\nभुगतान की तिथि: {due_on}\n\nटीम dFresh', 1),
  ('payment', 'hi', 'भुगतान प्राप्त हुआ: {order_no} के लिए Rs {amount}', 'प्रिय {customer},\n\nहमें आपका भुगतान प्राप्त हुआ। धन्यवाद।\n\nराशि: Rs {amount}\nतरीका: {mode}\nसंदर्भ: {reference}\nतिथि: {paid_on}\nऑर्डर: {order_no}\nइस ऑर्डर पर बकाया: Rs {amount_due}\n\nकृपया इस मेल को अपनी रसीद के रूप में रखें।\n\nटीम dFresh', 1),
  ('return_accepted', 'hi', 'रिटर्न {return_no} स्वीकार किया गया', 'प्रिय {customer},\n\nऑर्डर {order_no} के लिए आपका रिटर्न {return_no} स्वीकार कर लिया गया है: {items}.\n\nसामान मिलते ही हम आपको फिर से सूचित करेंगे।\n\nटीम dFresh', 1),
  ('return_picked', 'hi', 'रिटर्न {return_no}: सामान प्राप्त हुआ', 'प्रिय {customer},\n\nहमें आपके रिटर्न {return_no} का सामान मिल गया है। जाँच के बाद हम रिफंड के बारे में बताएँगे।\n\nटीम dFresh', 1),
  ('return_refunded', 'hi', 'रिटर्न {return_no} के लिए Rs {amount} का रिफंड', 'प्रिय {customer},\n\nआपके रिटर्न {return_no} के लिए Rs {amount} का रिफंड कर दिया गया है। हमारा क्रेडिट नोट {credit_note_no} संलग्न है।\n\nटीम dFresh', 1),
  ('wallet_credited', 'hi', 'आपके dFresh वॉलेट में Rs {amount} जोड़े गए', 'प्रिय {customer},\n\nआपके dFresh वॉलेट में Rs {amount} जोड़े गए: {reason}.\nवॉलेट बैलेंस: Rs {balance}\n\nअपने अगले ऑर्डर पर इसका उपयोग करें।\n\nटीम dFresh', 1),
  ('wallet_expiring', 'hi', 'आपके वॉलेट के Rs {amount} {expires_on} को समाप्त होंगे', 'प्रिय {customer},\n\nआपके dFresh वॉलेट के Rs {amount} {expires_on} को ({days} दिनों में) समाप्त हो जाएँगे। अपने अगले ऑर्डर पर इनका उपयोग करें।\nवॉलेट बैलेंस: Rs {balance}\n\nटीम dFresh', 1),
  ('overdue', 'hi', 'भुगतान अनुस्मारक: Rs {overdue_amount} बकाया', 'प्रिय {customer},\n\nहमारे रिकॉर्ड के अनुसार {overdue_count} इनवॉइस पर Rs {overdue_amount} की नियत तिथि बीत चुकी है: {invoices}.\n\nकुल बकाया: Rs {outstanding}\n\nआपका खाता विवरण संलग्न है। यदि आपने पहले ही भुगतान कर दिया है, तो कृपया इस मेल को अनदेखा करें और हमें भुगतान का संदर्भ भेजें।\n\nटीम dFresh', 1),

  ('approval', 'en', 'Approval waiting: {kind}', 'Hello {name},\n\nA request waits for your decision:\n\n{summary}\nRaised by: {requested_by}\n\nOpen Approvals: {link}', 0),
  ('stock_daily', 'en', 'Stock today: {low_count} low, {expiry_count} near expiry', 'Hello {name},\n\nLow stock (at or below the reorder level):\n{low_list}\n\nNear expiry or expired (within {expiry_days} days):\n{expiry_list}\n\nOpen Inventory: {link}', 0),
  ('follow_ups', 'en', 'Follow-ups due today: {count}', 'Hello {name},\n\nYour follow-ups due today or overdue:\n{list}\n\nOpen My follow-ups: {link}', 0),
  ('delivery_failed', 'en', 'Delivery failed: {order_no} ({customer})', 'Hello {name},\n\nThe delivery of {order_no} for {customer} failed on trip {trip}: {reason}.\n\nRe-attempt it or return it to the godown: {link}', 0),
  ('cash_difference', 'en', 'Cash difference on trip {trip}: Rs {difference}', 'Hello {name},\n\nTrip {trip} ({driver}) ended with a cash difference.\n\nCollected: Rs {collected}\nHanded over: Rs {handed}\nDifference: Rs {difference}\nNote: {note}\n\nOpen Delivery: {link}', 0),
  ('daily_summary', 'en', 'dFresh daily summary for {date}', 'Hello {name},\n\n{date}:\n{summary}\n\nOpen the Business view: {link}', 0);
