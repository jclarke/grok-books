import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { cx } from "../lib/cx";
import { isIsoDate, matchPreset, type DateRange, type Preset } from "../lib/dates";
import { formatRange } from "../lib/format";

export interface DateRangePickerProps {
  value: DateRange;
  presets: Preset[];
  onChange: (range: DateRange | null) => void;
  isDefault?: boolean;
  defaultLabel?: string;
  compact?: boolean;
}

export function DateRangePicker({ value, presets, onChange, isDefault, defaultLabel, compact }: DateRangePickerProps) {
  const preset = matchPreset(presets, value);
  const label = preset ? preset.label : formatRange(value.start, value.end);
  return (
    <Popover
      label="Date range"
      align="right"
      trigger={({ open, toggle, id, ref }) => (
        <button
          ref={ref}
          type="button"
          className={cx("range-trigger", compact && "range-trigger--compact")}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
          title={formatRange(value.start, value.end)}
        >
          <Icon name="calendar" size={16} />
          <span className="range-trigger__text">
            <span className="range-trigger__label">{label}</span>
            {!compact && preset ? <span className="range-trigger__dates">{formatRange(value.start, value.end)}</span> : null}
          </span>
          <Icon name="chevronDown" size={14} />
        </button>
      )}
    >
      {(close) => <RangePanel value={value} presets={presets} isDefault={isDefault} defaultLabel={defaultLabel} onChange={(range) => { onChange(range); close(); }} />}
    </Popover>
  );
}

function RangePanel({ value, presets, onChange, isDefault, defaultLabel }: { value: DateRange; presets: Preset[]; onChange: (range: DateRange | null) => void; isDefault?: boolean; defaultLabel?: string }) {
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(value.end);
  useEffect(() => {
    setStart(value.start);
    setEnd(value.end);
  }, [value.start, value.end]);
  const valid = isIsoDate(start) && isIsoDate(end) && start <= end;
  return (
    <div className="range-panel">
      <ul className="range-panel__presets" aria-label="Presets">
        {presets.map((item) => {
          const selected = item.range.start === value.start && item.range.end === value.end;
          return (
            <li key={item.key}>
              <button type="button" className={cx("range-preset", selected && "is-selected")} aria-pressed={selected} onClick={() => onChange(item.range)}>
                <span>{item.label}</span>
                <span className="range-preset__dates">{formatRange(item.range.start, item.range.end)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="range-panel__custom"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onChange({ start, end });
        }}
      >
        <p className="range-panel__heading">Custom range</p>
        <label className="field">
          <span className="field__label">From</span>
          <input className="input input--sm" type="date" value={start} max={end || undefined} onChange={(event) => setStart(event.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">To</span>
          <input className="input input--sm" type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} required />
        </label>
        {!valid ? <p className="field__error">Pick a start on or before the end.</p> : null}
        <div className="range-panel__actions">
          {!isDefault ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)}>
              Reset{defaultLabel ? ` to ${defaultLabel}` : ""}
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn btn--primary btn--sm" disabled={!valid}>
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}
