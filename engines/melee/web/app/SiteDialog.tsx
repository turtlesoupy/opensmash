import { useEffect, useRef, type ReactNode } from "react";
export default function SiteDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="site-dialog"
      ref={ref}
      aria-labelledby="site-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="site-dialog-content">
        <header>
          <h1 id="site-dialog-title">{title}</h1>
          <button className="retro-site-link" onClick={onClose} aria-label={`Close ${title}`}>
            Close ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
