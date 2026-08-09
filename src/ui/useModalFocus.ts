import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Only the topmost open modal traps Tab — a color/theme picker opened over the
// palette must win, otherwise both traps fight over the same keydown.
const stack: HTMLElement[] = [];

/**
 * Keeps Tab inside an open modal and returns focus to the trigger on close.
 * Without this `aria-modal="true"` lies: assistive tech is told the background
 * is inert while Tab walks straight into the sidebar behind the scrim.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const restore = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node) stack.push(node);

    const items = () =>
      [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => el.offsetParent !== null,
      );

    // ColorPicker autoFocuses nothing of its own — without this, Tab restarts
    // from the top of the app instead of entering the dialog.
    if (node && !node.contains(document.activeElement)) items()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || stack[stack.length - 1] !== ref.current) return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (active === (e.shiftKey ? first : last) || !ref.current?.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (node) {
        const index = stack.lastIndexOf(node);
        if (index >= 0) stack.splice(index, 1);
      }
      restore?.focus?.();
    };
  }, [open, ref]);
}
