import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "range"].includes(type);
  }
  return tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Normalize an event to "mod+k", "?", "j", "enter", "shift+enter", "escape". */
export function keyName(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  // Shift is part of a printable key ("?" not "shift+/"), so only name it for keys like Enter.
  if (event.shiftKey && event.key.length > 1) parts.push("shift");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}

/**
 * Global key bindings. Plain keys are ignored while typing in a field or
 * when a dialog is open; "mod+" bindings always fire.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const name = keyName(event);
      const handler = ref.current[name];
      if (!handler) return;
      const modified = name.startsWith("mod+");
      if (!modified && isTyping(event.target)) return;
      if (!modified && document.querySelector("[data-modal-open='true']")) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
