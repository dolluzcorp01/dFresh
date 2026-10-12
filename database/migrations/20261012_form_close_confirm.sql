-- Form modals: X / Esc on a form with typed values asks first (FormModal.js). The [Close] button reuses the
-- existing key `close`. Tamil / Hindi are drafts for native review (open item 9).
INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('close_confirm', 'forms', 'Question in a form when X / Esc is pressed after typing (the typed details stay saved in this tab). TA/HI: draft, native review (open item 9)', 0),
  ('keep_editing', 'forms', 'Button in that question: back to the form. TA/HI: draft, native review (open item 9)', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('close_confirm', 'en', 'Close without sending? Your details will be kept for next time.'),
  ('close_confirm', 'ta', 'அனுப்பாமல் மூடவா? உங்கள் விவரங்கள் அடுத்த முறைக்காக வைத்திருக்கப்படும்.'),
  ('close_confirm', 'hi', 'भेजे बिना बंद करें? आपकी जानकारी अगली बार के लिए रखी रहेगी।'),
  ('keep_editing', 'en', 'Keep editing'),
  ('keep_editing', 'ta', 'தொடர்ந்து நிரப்பவும்'),
  ('keep_editing', 'hi', 'भरना जारी रखें');
