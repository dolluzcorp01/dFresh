// Browser-side field checks from src/shared/rules.json (the API runs the same rules in validation.js).
// Returns a ui_text error key, or '' when the value is fine.
import rules from '../shared/rules.json';

const PATTERNS = Object.fromEntries(
  Object.entries(rules.patterns).map(([k, p]) => [k, new RegExp(p.source, p.flags)])
);

export function checkField(field, value, options) {
  if (field.type === 'pick') {
    return field.required && !(value && value.length) ? rules.errors.requiredPick : '';
  }
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (!field.required) return '';
    return field.type === 'select' ? rules.errors.requiredChoice : rules.errors.required;
  }
  if (field.type === 'select') return options && options.some((o) => o.value === v) ? '' : rules.errors.requiredChoice;
  if (PATTERNS[field.type] && !PATTERNS[field.type].test(v)) return rules.errors[field.type];
  return '';
}
