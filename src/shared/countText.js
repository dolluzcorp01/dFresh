// Live counts inside texts (Translations): {products}, {categories}, {towns}, {languages} become the number (digits,
// as the hero stats show it); {products_word} etc. become the number as a word from the language's own `num_words`
// text ("zero, one, two, ..."), with digits for a number past the end of that list. A word that starts the text gets
// a capital first letter (no effect in scripts without capitals). Counts = bootstrap stats: active product cards,
// active categories, active towns, active languages. The server fills them in once per language (Public_server.js),
// so the page, the pre-rendered HTML and the Google texts all get the same words.
// CommonJS: required by the server, imported by the admin (the placeholder list on the Translations screen).
const COUNTS = ['products', 'categories', 'towns', 'languages'];
const PATTERN = new RegExp(`\\{(${COUNTS.join('|')})(_word)?\\}`, 'g');

/** Words for 0, 1, 2, ... from a "zero, one, two" text. */
const numberWords = (text) => String(text || '').split(',').map((w) => w.trim());

function fillCounts(text, stats, words) {
  if (typeof text !== 'string' || !text.includes('{')) return text;
  return text.replace(PATTERN, (m, name, asWord, offset) => {
    const n = stats[name];
    if (typeof n !== 'number') return m;
    const word = asWord ? words[n] : '';
    if (!word) return String(n);
    return offset === 0 ? word.charAt(0).toLocaleUpperCase() + word.slice(1) : word;
  });
}

module.exports = { COUNTS, numberWords, fillCounts };
