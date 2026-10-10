// Fades / slides its content in once when 8% of it is visible (spec A5). Content is visible by default:
// the hidden "pre" state is only set by the observer's first report for an element that is off screen
// (so it never hides anything the visitor can see), and never with reduced motion or without
// IntersectionObserver. No getBoundingClientRect: measuring here forced a full-page layout per Reveal
// (and of the content-visibility sections) during the first render on phones.
import { useEffect, useRef, useState } from 'react';
import useReducedMotion from '../utils/useReducedMotion';

export default function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [pre, setPre] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || !('IntersectionObserver' in window)) {
      setPre(false);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setPre(false);
        io.disconnect();
      } else {
        setPre(true);
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
