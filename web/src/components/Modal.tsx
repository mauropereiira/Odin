import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  children,
  labelledBy,
  onClose,
  closeDisabled = false,
}: {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialog.showModal();
    const frame = requestAnimationFrame(() => {
      const target = dialog.querySelector<HTMLElement>("[data-modal-focus], [autofocus]");
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
      className="command-backdrop fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none border-0 bg-transparent p-4 text-inherit backdrop:bg-void/75 open:flex open:items-center open:justify-center"
    >
      {children}
    </dialog>
  );
}
