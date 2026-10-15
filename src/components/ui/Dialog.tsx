"use client";

import {
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  className?: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/** Native modal dialog with enter/exit materialize animation. */
export default function Dialog({
  open,
  onClose,
  labelledBy,
  label,
  className = "",
  children,
  initialFocusRef,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    if (!el.open) el.showModal();
    initialFocusRef?.current?.focus();
  }, [open, initialFocusRef]);

  if (!open) return null;

  const requestClose = () => {
    ref.current?.close();
    window.setTimeout(onClose, 280);
  };

  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) requestClose();
  };

  return (
    <dialog
      ref={ref}
      className={`pp-dialog ${className}`}
      aria-labelledby={labelledBy}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={onBackdrop}
    >
      <div className="p-6">{children}</div>
    </dialog>
  );
}
