-- Card photo carousel (ProductCarousel.js): announced to screen readers when the visitor changes the photo by
-- drag / swipe / arrow keys / dot (not for the auto-advance). {n} = photo number, {total} = photos incl. the spec
-- slide. Tamil / Hindi are drafts for native review (open item 9).
INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('card_photo_of', 'products', 'Product card photo position, screen-reader announcement. {n} = photo, {total} = photos. TA/HI: draft, native review (open item 9)', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('card_photo_of', 'en', 'Photo {n} of {total}'),
  ('card_photo_of', 'ta', 'படம் {n} / {total}'),
  ('card_photo_of', 'hi', 'चित्र {n} / {total}');
