// Fades / slides its content in once when 8% of it is visible (spec A5). Content is visible by default:
// the hidden "pre" state is only added after mount, for elements still below the fold, and never
// with reduced motion or without IntersectionObserver.
import { useLayoutEffect, useRef, useState } from 'react';
import useReducedMotion from '../utils/useReducedMotion';

export default function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [pre, setPre] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (reduced || !el || !('IntersectionObserver' in window)) {
      setPre(false);
      return undefined;
    }
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.92 && box.bottom > 0) return undefined; // already on screen
    setPre(true);
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setPre(false);
        io.disconnect();
      }
    }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <Tag ref={ref} className={`rv${pre ? ' pre' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </Tag>
  );
}
