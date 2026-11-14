// Browser-side field checks: the format checks of src/shared/formChecks.js and the field's own rules (required, from
// the form rules in the bootstrap). The API runs the same checks in validation.js.
// Returns a ui_text error key, or '' when the value is fine.
import { ERRORS, PATTERNS } from '../shared/formChecks';

export function checkField(field, value, options) {
  if (field.type === 'pick') {
    return field.required && !(value && value.length) ? ERRORS.requiredPick : '';
  }
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (!field.required) return '';
    return field.type === 'select' ? ERRORS.requiredChoice : ERRORS.required;
  }
  if (field.type === 'select') return options && options.some((o) => o.value === v) ? '' : ERRORS.requiredChoice;
  if (PATTERNS[field.type] && !PATTERNS[field.type].test(v)) return ERRORS[field.type];
  return '';
}
