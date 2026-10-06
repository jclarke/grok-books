import type { Business } from "../api/types";
import { Select } from "./Select";
import { useConfig } from "../hooks/useConfig";

export function BusinessSwitcher({ value, onChange, compact }: { value: Business; onChange: (value: Business) => void; compact?: boolean }) {
  const { businesses } = useConfig();
  return (
    <Select
      label="Business"
      hideLabel
      size="md"
      className={compact ? "business-switch business-switch--compact" : "business-switch"}
      value={value}
      onChange={(next) => onChange(next as Business)}
      options={[{ value: "all", label: "All businesses" }, ...businesses.map((row) => ({ value: row.slug, label: row.label }))]}
    />
  );
}
