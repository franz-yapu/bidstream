import { useState } from 'react';

/**
 * Precio con aviso accesible (`aria-live`) y un resalte breve cuando cambia. No anima la primera
 * carga: solo los cambios que llegan en vivo.
 */
export function LivePrice({ value }: { value: string }) {
  const [seen, setSeen] = useState(value);
  const [changes, setChanges] = useState(0);
  if (seen !== value) {
    // estado derivado del valor anterior: se ajusta durante el render, sin efecto
    setSeen(value);
    setChanges(changes + 1);
  }
  return (
    <p
      data-testid="price"
      aria-live="polite"
      aria-atomic="true"
      className="display num mt-1 text-[clamp(3rem,8vw,5.5rem)] leading-none"
    >
      <span key={changes} className={changes > 0 ? 'price-flash -mx-2 px-2' : ''}>
        {value}
      </span>
    </p>
  );
}
