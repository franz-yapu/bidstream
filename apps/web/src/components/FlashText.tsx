import { useState, type ReactNode } from 'react';

/**
 * Texto que se resalta un instante cuando cambia su valor (no en la primera carga). A diferencia de
 * `LivePrice`, no anuncia el cambio a lectores de pantalla: es para listas, no para el dato principal.
 */
export function FlashText({ value, children }: { value: string; children?: ReactNode }) {
  const [seen, setSeen] = useState(value);
  const [changes, setChanges] = useState(0);
  if (seen !== value) {
    setSeen(value);
    setChanges(changes + 1);
  }
  return (
    <span key={changes} className={changes > 0 ? 'price-flash -mx-1.5 px-1.5' : ''}>
      {children ?? value}
    </span>
  );
}
