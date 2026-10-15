-- Size picker (the "Pick a size" napkin card in For Business / Try it), admin fixes 15 Oct 2026:
--   - a stable key size_id: the position was the primary key, so dragging a row would have changed its key
--   - position becomes sort_order, dragged like categories (whole numbers 1..n, unique, positions.js)
--   - is_active: an inactive size is hidden from the chips
--   - at most one "Selected first" (is_default) row; none = the first active size is selected
--   - scale (the drawing's size against the largest one) kept within 0.1 .. 1
-- Size labels are not translated (there is no size_picker translation table).
USE dfresh;

ALTER TABLE size_picker DROP PRIMARY KEY;
ALTER TABLE size_picker ADD COLUMN size_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;
ALTER TABLE size_picker CHANGE position sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE size_picker ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER is_default;
ALTER TABLE size_picker ADD KEY idx_size_order (sort_order);

UPDATE size_picker s
  JOIN (SELECT size_id, ROW_NUMBER() OVER (ORDER BY sort_order, size_id) AS rn FROM size_picker) x USING (size_id)
   SET s.sort_order = x.rn;

UPDATE size_picker
   SET is_default = 0
 WHERE is_default = 1
   AND size_id <> (SELECT size_id FROM (SELECT size_id FROM size_picker WHERE is_default = 1 ORDER BY sort_order LIMIT 1) first_default);

UPDATE size_picker SET scale = LEAST(1, GREATEST(0.1, scale)) WHERE scale < 0.1 OR scale > 1;
