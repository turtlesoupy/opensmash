import { useCallback, useEffect, useRef, useState } from "react";
import { lockPageScroll } from "../shared/page-scroll-lock.js";

const DEFAULT_CLOSE_DURATION = 400;
const DEFAULT_FOCUS_DELAY = 570;

export default function ModalPage({
  bodyClass,
  children,
  className = "",
  closeDuration = DEFAULT_CLOSE_DURATION,
  dismissOnBackdrop = false,
  focusDelay = DEFAULT_FOCUS_DELAY,
  initialFocusRef,
  onRequestClose,
  onClosing,
  open,
  ...props
}) {
  const [isVisible, setIsVisible] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef(null);
  const onClosingRef = useRef(onClosing);
  onClosingRef.current = onClosing;
  const onRequestCloseRef = useRef(onRequestClose);

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  // `complete` runs in addition to onRequestClose, never instead of it: a
  // callback that does not flip `open` itself (Settings "Log Out") would
  // otherwise leave the page scroll-locked behind an invisible modal whose
  // closingRef stays set, so it could never be reopened.
  const close = useCallback((complete) => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClosingRef.current?.();
    setIsVisible(false);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      onRequestCloseRef.current?.();
      complete?.();
    }, closeDuration);
  }, [closeDuration]);

  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      setIsVisible(false);
      return undefined;
    }
    closingRef.current = false;
    const previousFocus = document.activeElement;
    const revealFrame = window.requestAnimationFrame(() => setIsVisible(true));
    const focusTimer = window.setTimeout(() => initialFocusRef?.current?.focus(), focusDelay);
    const releasePageScroll = lockPageScroll();
    if (bodyClass) document.body.classList.add(bodyClass);

    const closeOnEscape = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.cancelAnimationFrame(revealFrame);
      window.clearTimeout(focusTimer);
      window.clearTimeout(closeTimerRef.current);
      if (bodyClass) document.body.classList.remove(bodyClass);
      releasePageScroll();
      window.removeEventListener("keydown", closeOnEscape);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [bodyClass, close, focusDelay, initialFocusRef, open]);

  return (
    <div
      {...props}
      className={`modal-page ${className} ${isVisible ? "is-visible" : ""}`.trim()}
      hidden={!open}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) close();
      }}
    >
      {typeof children === "function" ? children(close) : children}
    </div>
  );
}
