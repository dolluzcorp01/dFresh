// Content protection (spec A4): a deterrent, not real protection. Blocks the context menu, copy / cut,
// image drag, text selection and Ctrl/Cmd + S / U / C everywhere except inside form fields.
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const KEYS = new Set(['s', 'u', 'c']);

function inField(node) {
  const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return Boolean(el && el.closest && el.closest(FIELD));
}

function block(e) {
  if (!inField(e.target)) e.preventDefault();
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && KEYS.has(String(e.key).toLowerCase()) && !inField(e.target)) e.preventDefault();
}

const EVENTS = ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart'];

// Returns the uninstall function (the admin console is not protected: staff copy lead details).
export function installProtection() {
  EVENTS.forEach((type) => document.addEventListener(type, block, true));
  document.addEventListener('keydown', onKey, true);
  document.documentElement.classList.add('protect');
  return () => {
    EVENTS.forEach((type) => document.removeEventListener(type, block, true));
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('protect');
  };
}
