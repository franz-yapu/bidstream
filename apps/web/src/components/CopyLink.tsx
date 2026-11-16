import { useEffect, useState } from 'react';
import { Check } from './icons';

/** Copia al portapapeles el enlace de la página actual y lo confirma un momento. */
export function CopyLink({ label = 'Copiar enlace' }: { label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, 2200);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={() => {
        navigator.clipboard.writeText(window.location.href).then(
          () => {
            setState('copied');
          },
          () => {
            setState('failed');
          },
        );
      }}
    >
      {state === 'copied' && <Check />}
      <span role="status">
        {state === 'copied' ? 'Enlace copiado' : state === 'failed' ? 'No se pudo copiar' : label}
      </span>
    </button>
  );
}
