-- lg_en ("the legal text is in English only", shown above a legal page whose body falls back to English) had an empty
-- English value. English never shows it, but the empty text made the Translations page count English as 1 missing
-- while the Languages page said 100%, and a new language without its own lg_en would fall back to the empty text and
-- show no note at all. It gets its English wording; only filled when still empty.
USE dfresh;

UPDATE ui_text SET value = 'The legal text is in English only.'
 WHERE text_key = 'lg_en' AND lang_code = (SELECT lang_code FROM languages WHERE is_default = 1 LIMIT 1) AND TRIM(value) = '';
