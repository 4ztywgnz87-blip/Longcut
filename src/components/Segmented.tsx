interface Props<T> {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}

/** A labelled two-way choice, used for all route preferences so they look alike. */
export default function Segmented<T>({ label, value, options, onChange }: Props<T>) {
  const id = `seg-${label.toLowerCase()}`;
  return (
    <div className="pref-row">
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button key={text} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
