/**
 * Modal
 * One dialog for the whole app: rendered in a portal on <body> (so no page
 * transform or overflow can clip the backdrop), centred, closes on Esc, the ×
 * button or a backdrop click (not while `busy`), moves focus into the dialog and
 * back to the opener when it closes.
 *
 * Pass `onSubmit` to make the body and footer one <form> (Enter submits).
 */
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import Icon from "../research/Icons";

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, description, children, footer, onSubmit, width = 520, busy = false }) {
  const titleId = useId();
  const cardRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    // Focus the first field (or the dialog itself) once it is on screen.
    const timer = window.setTimeout(() => {
      const card = cardRef.current;
      const first = card?.querySelector(`.modal-body ${FOCUSABLE}`) || card;
      first?.focus();
    }, 0);
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) {
        event.stopPropagation();
        closeRef.current?.();
      }
      // Keep Tab inside the dialog.
      if (event.key === "Tab" && cardRef.current) {
        const items = [...cardRef.current.querySelectorAll(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, busy]);

  if (!open) return null;

  const Body = onSubmit ? "form" : "div";
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose?.()}
    >
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(100%, ${width}px)` }}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close dialog">
            <Icon name="close" size={16} />
          </button>
        </header>
        <Body className="modal-content" onSubmit={onSubmit} noValidate={Boolean(onSubmit)}>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-actions">{footer}</div>}
        </Body>
      </div>
    </div>,
    document.body,
  );
}
