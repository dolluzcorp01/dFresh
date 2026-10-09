// Page scroll lock shared by every overlay (modals, products drawer). Counted, so closing a form opened
// over the drawer does not unlock the page under the drawer. The scrollbar's width is kept as padding
// so the page does not shift.
let count = 0;

export function lockScroll() {
  count += 1;
  if (count !== 1) return;
  const { body, documentElement } = document;
  const bar = window.innerWidth - documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (bar > 0) body.style.paddingInlineEnd = `${bar}px`;
}

export function unlockScroll() {
  if (count === 0) return;
  count -= 1;
  if (count !== 0) return;
  document.body.style.overflow = '';
  document.body.style.paddingInlineEnd = '';
}
