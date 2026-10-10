// webpack loader for the server bundle (scripts/prerender.js): a CSS import becomes an empty module.
// The browser gets the CSS from the normal build; the server only needs the markup.
module.exports = function ssrNullLoader() {
  return 'export {};';
};
