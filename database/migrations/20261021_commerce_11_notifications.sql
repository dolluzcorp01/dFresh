-- Commerce 11: Notifications (docs/COMMERCE-SPEC.md 5.5f; notifications.js): templates per event and language (English
-- for every event; Tamil and Hindi for the customer events, marked "check the wording"), the log of every message and
-- the daily job runs. mail_outbox: + attachments (documents built as PDF when the mail is sent).
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `notification_templates` (
  `event_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lang_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `needs_review` tinyint(1) NOT NULL DEFAULT '0',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`event_key`,`lang_code`),
  KEY `fk_ntpl_lang` (`lang_code`),
  CONSTRAINT `fk_ntpl_lang` FOREIGN KEY (`lang_code`) REFERENCES `languages` (`lang_code`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO notification_templates (event_key, lang_code, subject, body, needs_review) VALUES
  ('approval', 'en', 'Approval waiting: {kind}', 'Hello {name},\n\nA request waits for your decision:\n\n{summary}\nRaised by: {requested_by}\n\nOpen Approvals: {link}', 0),
  ('cash_difference', 'en', 'Cash difference on trip {trip}: Rs {difference}', 'Hello {name},\n\nTrip {trip} ({driver}) ended with a cash difference.\n\nCollected: Rs {collected}\nHanded over: Rs {handed}\nDifference: Rs {difference}\nNote: {note}\n\nOpen Delivery: {link}', 0),
  ('daily_summary', 'en', 'dFresh daily summary for {date}', 'Hello {name},\n\n{date}:\n{summary}\n\nOpen the Business view: {link}', 0),
  ('delivery_failed', 'en', 'Delivery failed: {order_no} ({customer})', 'Hello {name},\n\nThe delivery of {order_no} for {customer} failed on trip {trip}: {reason}.\n\nRe-attempt it or return it to the godown: {link}', 0),
  ('follow_ups', 'en', 'Follow-ups due today: {count}', 'Hello {name},\n\nYour follow-ups due today or overdue:\n{list}\n\nOpen My follow-ups: {link}', 0),
  ('invoice', 'en', 'Invoice {invoice_no} for order {order_no}', 'Dear {customer},\n\nPlease find attached our tax invoice {invoice_no} for order {order_no}.\n\nInvoice total: Rs {total}\nDue on: {due_on}\n\nTeam dFresh', 0),
  ('invoice', 'hi', 'ऑर्डर {order_no} का इनवॉइस {invoice_no}', 'प्रिय {customer},\n\nऑर्डर {order_no} का हमारा टैक्स इनवॉइस {invoice_no} संलग्न है।\n\nइनवॉइस कुल: Rs {total}\nभुगतान की तिथि: {due_on}\n\nटीम dFresh', 1),
  ('invoice', 'ta', 'ஆர்டர் {order_no}-க்கான விலைப்பட்டியல் {invoice_no}', 'அன்புள்ள {customer},\n\nஆர்டர் {order_no}-க்கான எங்கள் வரி விலைப்பட்டியல் {invoice_no} இணைக்கப்பட்டுள்ளது.\n\nவிலைப்பட்டியல் மொத்தம்: Rs {total}\nசெலுத்த வேண்டிய தேதி: {due_on}\n\ndFresh குழு', 1),
  ('order_confirmed', 'en', 'Order {order_no} confirmed', 'Dear {customer},\n\nThank you for your order {order_no}. We have confirmed it and will pack it soon.\n\nOrder value: Rs {total}\nItems: {items}\nDelivery to: {ship_to}\n\nWe will write again when it leaves our godown.\n\nTeam dFresh', 0),
  ('order_confirmed', 'hi', 'ऑर्डर {order_no} की पुष्टि हो गई', 'प्रिय {customer},\n\nआपके ऑर्डर {order_no} के लिए धन्यवाद। हमने इसकी पुष्टि कर दी है और जल्द ही इसे पैक करेंगे।\n\nऑर्डर मूल्य: Rs {total}\nसामान: {items}\nडिलीवरी पता: {ship_to}\n\nगोदाम से निकलते ही हम फिर से सूचित करेंगे।\n\nटीम dFresh', 1),
  ('order_confirmed', 'ta', 'ஆர்டர் {order_no} உறுதி செய்யப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no}-க்கு நன்றி. அதை உறுதி செய்துள்ளோம், விரைவில் பேக் செய்வோம்.\n\nஆர்டர் மதிப்பு: Rs {total}\nபொருட்கள்: {items}\nடெலிவரி முகவரி: {ship_to}\n\nஎங்கள் கிடங்கிலிருந்து அனுப்பியதும் மீண்டும் தெரிவிப்போம்.\n\ndFresh குழு', 1),
  ('order_courier', 'en', 'Order {order_no} handed to {courier}', 'Dear {customer},\n\nYour order {order_no} was handed to {courier} today. AWB number: {awb}\n\nTrack it here: {tracking_link}\n\nTeam dFresh', 0),
  ('order_courier', 'hi', 'ऑर्डर {order_no} {courier} को सौंपा गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} आज {courier} को सौंपा गया। AWB नंबर: {awb}\n\nयहाँ ट्रैक करें: {tracking_link}\n\nटीम dFresh', 1),
  ('order_courier', 'ta', 'ஆர்டர் {order_no} {courier}-இடம் ஒப்படைக்கப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} இன்று {courier}-இடம் ஒப்படைக்கப்பட்டது. AWB எண்: {awb}\n\nஇங்கே கண்காணிக்கலாம்: {tracking_link}\n\ndFresh குழு', 1),
  ('order_delivered', 'en', 'Order {order_no} delivered', 'Dear {customer},\n\nYour order {order_no} was delivered today to {received_by}. Thank you for choosing dFresh.\n\nAnything wrong with the goods? Reply to this mail within {return_days} days.\n\nTeam dFresh', 0),
  ('order_delivered', 'hi', 'ऑर्डर {order_no} डिलीवर हो गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} आज {received_by} को डिलीवर किया गया। dFresh चुनने के लिए धन्यवाद।\n\nसामान में कोई कमी हो तो {return_days} दिनों के भीतर इस मेल का जवाब दें।\n\nटीम dFresh', 1),
  ('order_delivered', 'ta', 'ஆர்டர் {order_no} டெலிவரி செய்யப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} இன்று {received_by} அவர்களிடம் டெலிவரி செய்யப்பட்டது. dFresh-ஐ தேர்ந்தெடுத்ததற்கு நன்றி.\n\nபொருட்களில் ஏதேனும் குறை இருந்தால், {return_days} நாட்களுக்குள் இந்த மின்னஞ்சலுக்கு பதில் அனுப்புங்கள்.\n\ndFresh குழு', 1),
  ('order_out', 'en', 'Order {order_no} is out for delivery', 'Dear {customer},\n\nYour order {order_no} left our godown today on our own vehicle and will reach you today.\n\nDelivery to: {ship_to}\nBalance to pay: Rs {amount_due}\n\nTeam dFresh', 0),
  ('order_out', 'hi', 'ऑर्डर {order_no} डिलीवरी के लिए निकल गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} आज हमारे वाहन से निकल गया है और आज ही आप तक पहुँचेगा।\n\nडिलीवरी पता: {ship_to}\nदेय राशि: Rs {amount_due}\n\nटीम dFresh', 1),
  ('order_out', 'ta', 'ஆர்டர் {order_no} டெலிவரிக்கு புறப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} இன்று எங்கள் வாகனத்தில் புறப்பட்டது, இன்றே உங்களை வந்தடையும்.\n\nடெலிவரி முகவரி: {ship_to}\nசெலுத்த வேண்டிய தொகை: Rs {amount_due}\n\ndFresh குழு', 1),
  ('order_packed', 'en', 'Order {order_no} is packed', 'Dear {customer},\n\nYour order {order_no} is packed ({cartons} carton(s)) and will leave our godown soon.\n\nTeam dFresh', 0),
  ('order_packed', 'hi', 'ऑर्डर {order_no} पैक हो गया', 'प्रिय {customer},\n\nआपका ऑर्डर {order_no} पैक हो गया है ({cartons} कार्टन) और जल्द ही हमारे गोदाम से निकलेगा।\n\nटीम dFresh', 1),
  ('order_packed', 'ta', 'ஆர்டர் {order_no} பேக் செய்யப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் ஆர்டர் {order_no} பேக் செய்யப்பட்டது ({cartons} அட்டைப்பெட்டி). விரைவில் எங்கள் கிடங்கிலிருந்து அனுப்பப்படும்.\n\ndFresh குழு', 1),
  ('overdue', 'en', 'Payment reminder: Rs {overdue_amount} overdue', 'Dear {customer},\n\nOur records show Rs {overdue_amount} overdue on {overdue_count} invoice(s): {invoices}.\n\nTotal outstanding: Rs {outstanding}\n\nYour statement of account is attached. If you have paid already, please ignore this mail and send us the payment reference.\n\nTeam dFresh', 0),
  ('overdue', 'hi', 'भुगतान अनुस्मारक: Rs {overdue_amount} बकाया', 'प्रिय {customer},\n\nहमारे रिकॉर्ड के अनुसार {overdue_count} इनवॉइस पर Rs {overdue_amount} की नियत तिथि बीत चुकी है: {invoices}.\n\nकुल बकाया: Rs {outstanding}\n\nआपका खाता विवरण संलग्न है। यदि आपने पहले ही भुगतान कर दिया है, तो कृपया इस मेल को अनदेखा करें और हमें भुगतान का संदर्भ भेजें।\n\nटीम dFresh', 1),
  ('overdue', 'ta', 'பணம் செலுத்த நினைவூட்டல்: Rs {overdue_amount} நிலுவையில் உள்ளது', 'அன்புள்ள {customer},\n\nஎங்கள் பதிவுகளின்படி {overdue_count} விலைப்பட்டியல்களில் Rs {overdue_amount} செலுத்தும் தேதி கடந்து நிலுவையில் உள்ளது: {invoices}.\n\nமொத்த நிலுவை: Rs {outstanding}\n\nஉங்கள் கணக்கு அறிக்கை இணைக்கப்பட்டுள்ளது. ஏற்கனவே செலுத்தியிருந்தால், இந்த மின்னஞ்சலைப் புறக்கணித்து, பணம் செலுத்திய குறிப்பு எண்ணை எங்களுக்கு அனுப்புங்கள்.\n\ndFresh குழு', 1),
  ('payment', 'en', 'Payment received: Rs {amount} for {order_no}', 'Dear {customer},\n\nWe received your payment. Thank you.\n\nAmount: Rs {amount}\nMode: {mode}\nReference: {reference}\nDate: {paid_on}\nOrder: {order_no}\nBalance due on this order: Rs {amount_due}\n\nPlease keep this mail as your receipt.\n\nTeam dFresh', 0),
  ('payment', 'hi', 'भुगतान प्राप्त हुआ: {order_no} के लिए Rs {amount}', 'प्रिय {customer},\n\nहमें आपका भुगतान प्राप्त हुआ। धन्यवाद।\n\nराशि: Rs {amount}\nतरीका: {mode}\nसंदर्भ: {reference}\nतिथि: {paid_on}\nऑर्डर: {order_no}\nइस ऑर्डर पर बकाया: Rs {amount_due}\n\nकृपया इस मेल को अपनी रसीद के रूप में रखें।\n\nटीम dFresh', 1),
  ('payment', 'ta', 'பணம் பெறப்பட்டது: {order_no}-க்கு Rs {amount}', 'அன்புள்ள {customer},\n\nஉங்கள் பணம் பெறப்பட்டது. நன்றி.\n\nதொகை: Rs {amount}\nமுறை: {mode}\nகுறிப்பு எண்: {reference}\nதேதி: {paid_on}\nஆர்டர்: {order_no}\nஇந்த ஆர்டரில் மீதமுள்ள தொகை: Rs {amount_due}\n\nஇந்த மின்னஞ்சலை உங்கள் ரசீதாக வைத்துக்கொள்ளுங்கள்.\n\ndFresh குழு', 1),
  ('return_accepted', 'en', 'Return {return_no} accepted', 'Dear {customer},\n\nWe accepted your return {return_no} for order {order_no}: {items}.\n\nWe will write again when we have the goods.\n\nTeam dFresh', 0),
  ('return_accepted', 'hi', 'रिटर्न {return_no} स्वीकार किया गया', 'प्रिय {customer},\n\nऑर्डर {order_no} के लिए आपका रिटर्न {return_no} स्वीकार कर लिया गया है: {items}.\n\nसामान मिलते ही हम आपको फिर से सूचित करेंगे।\n\nटीम dFresh', 1),
  ('return_accepted', 'ta', 'திருப்பி அனுப்புதல் {return_no} ஏற்கப்பட்டது', 'அன்புள்ள {customer},\n\nஆர்டர் {order_no}-க்கான உங்கள் திருப்பி அனுப்புதல் {return_no} ஏற்கப்பட்டது: {items}.\n\nபொருட்களைப் பெற்றதும் மீண்டும் தெரிவிப்போம்.\n\ndFresh குழு', 1),
  ('return_picked', 'en', 'Return {return_no}: goods collected', 'Dear {customer},\n\nWe have the goods of your return {return_no}. We will check them and tell you about the refund.\n\nTeam dFresh', 0),
  ('return_picked', 'hi', 'रिटर्न {return_no}: सामान प्राप्त हुआ', 'प्रिय {customer},\n\nहमें आपके रिटर्न {return_no} का सामान मिल गया है। जाँच के बाद हम रिफंड के बारे में बताएँगे।\n\nटीम dFresh', 1),
  ('return_picked', 'ta', 'திருப்பி அனுப்புதல் {return_no}: பொருட்கள் பெறப்பட்டன', 'அன்புள்ள {customer},\n\nஉங்கள் திருப்பி அனுப்புதல் {return_no}-இன் பொருட்களைப் பெற்றுக்கொண்டோம். அவற்றைச் சரிபார்த்து, பணத்தைத் திருப்பித் தருவது பற்றி தெரிவிப்போம்.\n\ndFresh குழு', 1),
  ('return_refunded', 'en', 'Refund for return {return_no}: Rs {amount}', 'Dear {customer},\n\nWe have refunded Rs {amount} for your return {return_no}. Our credit note {credit_note_no} is attached.\n\nTeam dFresh', 0),
  ('return_refunded', 'hi', 'रिटर्न {return_no} के लिए Rs {amount} का रिफंड', 'प्रिय {customer},\n\nआपके रिटर्न {return_no} के लिए Rs {amount} का रिफंड कर दिया गया है। हमारा क्रेडिट नोट {credit_note_no} संलग्न है।\n\nटीम dFresh', 1),
  ('return_refunded', 'ta', 'திருப்பி அனுப்புதல் {return_no}-க்கு Rs {amount} திருப்பித் தரப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் திருப்பி அனுப்புதல் {return_no}-க்கு Rs {amount} திருப்பித் தரப்பட்டது. எங்கள் கடன் குறிப்பு {credit_note_no} இணைக்கப்பட்டுள்ளது.\n\ndFresh குழு', 1),
  ('stock_daily', 'en', 'Stock today: {low_count} low, {expiry_count} near expiry', 'Hello {name},\n\nLow stock (at or below the reorder level):\n{low_list}\n\nNear expiry or expired (within {expiry_days} days):\n{expiry_list}\n\nOpen Inventory: {link}', 0),
  ('wallet_credited', 'en', 'Rs {amount} added to your dFresh wallet', 'Dear {customer},\n\nRs {amount} was added to your dFresh wallet: {reason}.\nWallet balance: Rs {balance}\n\nUse it on your next order.\n\nTeam dFresh', 0),
  ('wallet_credited', 'hi', 'आपके dFresh वॉलेट में Rs {amount} जोड़े गए', 'प्रिय {customer},\n\nआपके dFresh वॉलेट में Rs {amount} जोड़े गए: {reason}.\nवॉलेट बैलेंस: Rs {balance}\n\nअपने अगले ऑर्डर पर इसका उपयोग करें।\n\nटीम dFresh', 1),
  ('wallet_credited', 'ta', 'உங்கள் dFresh வாலட்டில் Rs {amount} சேர்க்கப்பட்டது', 'அன்புள்ள {customer},\n\nஉங்கள் dFresh வாலட்டில் Rs {amount} சேர்க்கப்பட்டது: {reason}.\nவாலட் இருப்பு: Rs {balance}\n\nஉங்கள் அடுத்த ஆர்டரில் பயன்படுத்துங்கள்.\n\ndFresh குழு', 1),
  ('wallet_expiring', 'en', 'Rs {amount} of your wallet expires on {expires_on}', 'Dear {customer},\n\nRs {amount} in your dFresh wallet expires on {expires_on} (in {days} days). Use it on your next order.\nWallet balance: Rs {balance}\n\nTeam dFresh', 0),
  ('wallet_expiring', 'hi', 'आपके वॉलेट के Rs {amount} {expires_on} को समाप्त होंगे', 'प्रिय {customer},\n\nआपके dFresh वॉलेट के Rs {amount} {expires_on} को ({days} दिनों में) समाप्त हो जाएँगे। अपने अगले ऑर्डर पर इनका उपयोग करें।\nवॉलेट बैलेंस: Rs {balance}\n\nटीम dFresh', 1),
  ('wallet_expiring', 'ta', 'உங்கள் வாலட்டில் Rs {amount} {expires_on} அன்று காலாவதியாகும்', 'அன்புள்ள {customer},\n\nஉங்கள் dFresh வாலட்டில் உள்ள Rs {amount} {expires_on} அன்று ({days} நாட்களில்) காலாவதியாகும். உங்கள் அடுத்த ஆர்டரில் பயன்படுத்துங்கள்.\nவாலட் இருப்பு: Rs {balance}\n\ndFresh குழு', 1);

CREATE TABLE IF NOT EXISTS `notification_log` (
  `log_id` bigint NOT NULL AUTO_INCREMENT,
  `event_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `audience` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'email',
  `recipient` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lang_code` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'queued',
  `skip_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mail_id` bigint DEFAULT NULL,
  `customer_id` int DEFAULT NULL,
  `order_id` bigint DEFAULT NULL,
  `return_id` bigint DEFAULT NULL,
  `ref` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_test` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  KEY `idx_nlog_event` (`event_key`,`created_at`),
  KEY `idx_nlog_customer` (`customer_id`,`created_at`),
  KEY `idx_nlog_order` (`order_id`),
  KEY `idx_nlog_mail` (`mail_id`),
  CONSTRAINT `fk_nlog_mail` FOREIGN KEY (`mail_id`) REFERENCES `mail_outbox` (`mail_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_runs` (
  `job_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `run_day` date NOT NULL,
  `ran_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `result` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`job_key`,`run_day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- live table
ALTER TABLE mail_outbox ADD COLUMN attachments VARCHAR(500) NULL AFTER text_body; -- JSON [{"kind":"invoice","id":12}]
