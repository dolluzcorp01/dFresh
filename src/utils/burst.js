// Small paper confetti burst at a screen point (hero sheet tap). Pieces remove themselves; nothing with
// reduced motion.
const REDUCE = '(prefers-reduced-motion: reduce)';

export function burst(x, y, n = 22) {
  if (window.matchMedia(REDUCE).matches || !Element.prototype.animate) return;
  for (let i = 0; i < n; i += 1) {
    const d = document.createElement('i');
    d.className = `burst${i % 3 === 0 ? ' g' : ''}`;
    d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
    const a = Math.random() * Math.PI * 2;
    const v = 80 + Math.random() * 180;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v - 120;
    const r = (Math.random() - 0.5) * 720;
    d.animate(
      [
        { transform: `translate(${x}px, ${y}px) rotate(0) scale(1)`, opacity: 1 },
        { transform: `translate(${x + dx}px, ${y + dy + 260}px) rotate(${r}deg) scale(.4)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 700, easing: 'cubic-bezier(.2, .7, .4, 1)' }
    ).onfinish = () => d.remove();
  }
}
