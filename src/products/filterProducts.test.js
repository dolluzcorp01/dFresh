import { filterChips, filterKey, filterProducts } from './filterProducts';

const P = [
  { id: 'DZIND-DF007', category: 'napkins', forHome: true, name: 'Napkins 30×30', nameEn: 'Napkins 30×30', spec: '1-ply · 30×30 cm', keywords: ['1-ply'], variants: [] },
  { id: 'DZIND-DF008', category: 'napkins', forHome: true, name: 'நாப்கின்கள்', nameEn: '2-ply Napkins 29×30', spec: '2-ply', keywords: ['2-ply'],
    variants: [{ id: 'DZIND-DF008-BUR', name: 'நாப்கின்கள் - பர்கண்டி', nameEn: '2-ply Napkins 29×30 - Burgundy', spec: '2-ply · Burgundy', keywords: [] }] },
  { id: 'DZIND-DF044', category: 'wipes', forHome: false, name: 'Wet Wipes', nameEn: 'Wet Wipes', spec: '', keywords: ['Wipes'], variants: [] },
];
const ids = (l) => l.map((p) => p.id);

test('x and × are the same', () => {
  expect(ids(filterProducts(P, 'all', '30x30'))).toEqual(['DZIND-DF007']);
  expect(ids(filterProducts(P, 'all', '30×30'))).toEqual(['DZIND-DF007']);
});
test('ID with or without prefix, any case', () => {
  expect(ids(filterProducts(P, 'all', 'df044'))).toEqual(['DZIND-DF044']);
  expect(ids(filterProducts(P, 'all', 'DZIND-DF044'))).toEqual(['DZIND-DF044']);
  expect(ids(filterProducts(P, 'all', '  Df044 '))).toEqual(['DZIND-DF044']);
});
test('English name while browsing another language, and variants', () => {
  expect(ids(filterProducts(P, 'all', '2-ply napkins'))).toEqual(['DZIND-DF008']);
  expect(ids(filterProducts(P, 'all', 'burgundy'))).toEqual(['DZIND-DF008']);
  expect(ids(filterProducts(P, 'all', 'பர்கண்டி'))).toEqual(['DZIND-DF008']);
});
test('no match -> empty', () => {
  expect(filterProducts(P, 'all', 'zzz')).toEqual([]);
});
test('filters', () => {
  expect(ids(filterProducts(P, 'home', ''))).toEqual(['DZIND-DF007', 'DZIND-DF008']);
  expect(ids(filterProducts(P, 'wipes', ''))).toEqual(['DZIND-DF044']);
  expect(filterKey('home', [])).toBe('home');
  expect(filterKey('napkins', [{ key: 'napkins' }])).toBe('napkins');
  expect(filterKey('nope', [{ key: 'napkins' }])).toBe('all');
});
test('chips count cards, not variants', () => {
  const chips = filterChips(P, [{ key: 'napkins', name: 'Napkins', count: 2 }], (k) => k);
  expect(chips.map((c) => `${c.key}:${c.count}`)).toEqual(['all:3', 'home:2', 'napkins:2']);
});
