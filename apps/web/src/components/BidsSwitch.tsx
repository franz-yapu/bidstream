/** Interruptor «Mostrar pujas»: abre las pujas de todos los billetes de la página a la vez. */
export function BidsSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[15px] font-medium">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 rounded-full bg-sand-deep transition-colors duration-150 peer-checked:bg-forest peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-forest after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-paper after:transition-transform after:duration-200 after:ease-out peer-checked:after:translate-x-5"
      />
      Mostrar pujas
    </label>
  );
}
