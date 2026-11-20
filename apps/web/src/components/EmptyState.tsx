import type { ReactNode } from 'react';

/** Estado vacío: dice qué pasa y qué se puede hacer, sin ilustración de relleno. */
export function EmptyState({
  title,
  children,
  onDark = false,
}: {
  title: string;
  children?: ReactNode;
  /** Sobre una banda oscura: fondo de cristal y texto claro. */
  onDark?: boolean;
}) {
  return (
    <div
      className={`rounded-[16px] px-6 py-10 text-center ${onDark ? 'glass text-ink' : 'bg-sand/60'}`}
    >
      <p className="display text-2xl">{title}</p>
      {children !== undefined && (
        <div className={`mx-auto mt-2 max-w-md ${onDark ? 'text-ink-soft' : 'text-ink-soft'}`}>
          {children}
        </div>
      )}
    </div>
  );
}
