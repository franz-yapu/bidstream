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
      className="text-4xl font-bold tabular-nums"
    >
      <span key={changes} className={changes > 0 ? 'price-flash px-1 -mx-1' : ''}>
        {value}
      </span>
    </p>
  );
}
