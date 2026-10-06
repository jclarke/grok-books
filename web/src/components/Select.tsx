import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { Icon } from "./Icon";
import { cx } from "../lib/cx";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "size"> {
  label?: ReactNode;
  hideLabel?: boolean;
  options: SelectOption[];
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  hint?: ReactNode;
}

/** Native select (fast, accessible, great on phones) with the design-system look. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, options, onChange, size = "md", className, id, hint, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const groups = new Map<string, SelectOption[]>();
  const loose: SelectOption[] = [];
  for (const option of options) {
    if (option.group) {
      const list = groups.get(option.group) ?? [];
      list.push(option);
      groups.set(option.group, list);
    } else {
      loose.push(option);
    }
  }
  return (
    <div className={cx("field", className)}>
      {label ? (
        <label htmlFor={selectId} className={cx("field__label", hideLabel && "sr-only")}>
          {label}
        </label>
      ) : null}
      <div className={cx("select", `select--${size}`)}>
        <select ref={ref} id={selectId} onChange={(event) => onChange?.(event.target.value)} {...rest}>
          {loose.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {Array.from(groups.entries()).map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Icon name="chevronDown" size={15} className="select__chevron" />
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
});

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
  inputSize?: "sm" | "md";
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, hint, error, className, id, inputSize = "md", ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cx("field", className)}>
      <label htmlFor={inputId} className={cx("field__label", hideLabel && "sr-only")}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={cx("input", `input--${inputSize}`, error && "input--invalid")}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? hintId : undefined}
        {...rest}
      />
      {error ? (
        <p className="field__error" id={hintId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
