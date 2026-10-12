-- Hero tissue "pick it up anywhere" (TissueSheet.js, preview docs/reference/dfresh-feel-gentle-tissue-pinch.html):
-- the hint under the tissue (key touch) and its screen-reader description (key sheet_label). Only rows that still
-- hold the earlier seeded text change, so an edit made in the admin is kept. Tamil / Hindi are drafts for native
-- review (open item 9).
UPDATE ui_text SET value = 'Touch it, or pick it up anywhere' WHERE text_key = 'touch' AND lang_code = 'en' AND value = 'Touch the tissue';
UPDATE ui_text SET value = 'தொடுங்கள் அல்லது எங்கும் பிடித்துத் தூக்குங்கள்' WHERE text_key = 'touch' AND lang_code = 'ta' AND value = 'டிஷ்யூவைத் தொடுங்கள்';
UPDATE ui_text SET value = 'छुएँ, या कहीं से भी पकड़कर उठाएँ' WHERE text_key = 'touch' AND lang_code = 'hi' AND value = 'टिश्यू को छुएँ';

UPDATE ui_text SET value = 'A soft sheet of dFresh tissue that ripples when touched and can be picked up from anywhere'
 WHERE text_key = 'sheet_label' AND lang_code = 'en' AND value = 'A soft sheet of dFresh tissue that ripples when touched';
UPDATE ui_text SET value = 'தொட்டால் அலைபோல் அசையும், எங்கிருந்தும் பிடித்துத் தூக்கக்கூடிய மென்மையான dFresh டிஷ்யூ'
 WHERE text_key = 'sheet_label' AND lang_code = 'ta' AND value = 'தொட்டால் அலைபோல் அசையும் மென்மையான dFresh டிஷ்யூ';
UPDATE ui_text SET value = 'छूने पर लहराता और कहीं से भी पकड़कर उठाया जा सकने वाला मुलायम dFresh टिश्यू'
 WHERE text_key = 'sheet_label' AND lang_code = 'hi' AND value = 'छूने पर लहराता हुआ मुलायम dFresh टिश्यू';

UPDATE ui_text_keys SET description = 'Hint under the hero tissue (touch / pick it up). TA/HI: draft, native review (open item 9)' WHERE text_key = 'touch';
UPDATE ui_text_keys SET description = 'Hero tissue sheet, screen-reader description (ripples, can be picked up). TA/HI: draft, native review (open item 9)' WHERE text_key = 'sheet_label';
