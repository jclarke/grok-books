import { useMode } from "../hooks/useMode";
import { cx } from "../lib/cx";
import type { Mode } from "../lib/mode";

const OPTIONS: { value: Mode; label: string }[] = [
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
];

/**
 * Business | Personal switch. Not the brand switcher: that one picks a
 * business inside Business mode. The choice is kept in the URL and in
 * localStorage (hpbooks.mode) and the date range carries over.
 */
export function ModeToggle({ compact }: { compact?: boolean }) {
  const { mode, switchMode } = useMode();
  return (
    <div className={cx("mode-toggle", compact && "mode-toggle--compact", `mode-toggle--${mode}`)} role="group" aria-label="Mode">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("mode-toggle__item", mode === option.value && "is-active")}
          aria-pressed={mode === option.value}
          onClick={() => switchMode(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
