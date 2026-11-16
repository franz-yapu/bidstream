import { LOT_ORDERS, type LotOrder } from '../lib/lots';

export function LotSort({
  value,
  onChange,
}: {
  value: LotOrder;
  onChange: (order: LotOrder) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="lot-order" className="text-[15px] text-ink-soft">
        Ordenar por
      </label>
      <select
        id="lot-order"
        className="field w-auto py-1.5 pr-8"
        value={value}
        onChange={(e) => {
          onChange(e.target.value as LotOrder);
        }}
      >
        {LOT_ORDERS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
