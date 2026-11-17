import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Muestra su contenido con una entrada suave la primera vez que aparece en pantalla. */
export function Reveal({
  children,
  className = '',
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Orden dentro de un grupo: retrasa la entrada para escalonarla. */
  index?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const supported = typeof IntersectionObserver !== 'undefined';
  const [shown, setShown] = useState(!supported);
  useEffect(() => {
    const node = ref.current;
    if (!supported || node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [supported]);
  return (
    <div
      ref={ref}
      className={`reveal ${shown ? 'is-in' : ''} ${className}`}
      style={{ '--i': index } as CSSProperties}
    >
      {children}
    </div>
  );
}
