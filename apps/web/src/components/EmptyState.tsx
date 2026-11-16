import type { ReactNode } from 'react';

/** Estado vacío: dice qué pasa y qué se puede hacer, sin ilustración de relleno. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[16px] bg-sand/60 px-6 py-10 text-center">
      <p className="display text-2xl">{title}</p>
      {children !== undefined && (
        <div className="mx-auto mt-2 max-w-md text-ink-soft">{children}</div>
      )}
    </div>
  );
}
