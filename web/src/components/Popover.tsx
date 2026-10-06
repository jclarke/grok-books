import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";

export interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void; id: string; ref: React.RefObject<HTMLButtonElement> }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  label: string;
}

/** Click-to-open panel anchored under its trigger. Escape or an outside click closes it. */
export function Popover({ trigger, children, align = "left", className, label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className={cx("popover", className)} ref={root}>
      {trigger({ open, toggle: () => setOpen((value) => !value), id, ref: button })}
      {open ? (
        <div className={cx("popover__panel", `popover__panel--${align}`)} id={id} role="dialog" aria-label={label}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
