import { cx } from "../lib/cx";
import { formatMoney } from "../lib/format";

export interface MoneyProps {
  cents: number | null | undefined;
  /** Color positives green as well as negatives red (for in/out amounts). */
  colorPositive?: boolean;
  /** Show a leading + on positive values. */
  signed?: boolean;
  whole?: boolean;
  strong?: boolean;
  className?: string;
}

/** Money with tabular figures; negatives are red. */
export function Money({ cents, colorPositive, signed, whole, strong, className }: MoneyProps) {
  if (cents === null || cents === undefined) return <span className={cx("money money--empty", className)}>—</span>;
  const text = formatMoney(cents, { whole });
  return (
    <span
      className={cx(
        "money",
        cents < 0 && "money--neg",
        colorPositive && cents > 0 && "money--pos",
        strong && "money--strong",
        className,
      )}
    >
      {signed && cents > 0 ? "+" : ""}
      {text}
    </span>
  );
}

/** A right-aligned table cell holding Money. */
export function MoneyCell(props: MoneyProps & { as?: "td" | "div" }) {
  const { as: Tag = "td", ...rest } = props;
  return (
    <Tag className="num">
      <Money {...rest} />
    </Tag>
  );
}
