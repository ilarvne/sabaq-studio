import type { ReactNode } from 'react';
import { Button } from '@/components/shadcn/button';
import { Dialog, DialogPopup, DialogHeader, DialogPanel, DialogTitle } from '@/components/coss/dialog';
import { ToolbarButton } from '@/components/coss/toolbar';
import type { EditorCopy } from './editorCopy';

export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  pressed,
  toolbar = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  toolbar?: boolean;
}) {
  const button = (
    <Button
      className="ed-icon"
      size="icon-sm"
      variant="ghost"
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
  return toolbar ? <ToolbarButton disabled={disabled} render={button} /> : button;
}

export function Modal({
  title,
  children,
  close,
  c,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  c: EditorCopy;
}) {
  return (
    <Dialog defaultOpen onOpenChange={(open) => { if (!open) close(); }}>
      <DialogPopup className="inspector-dialog" closeProps={{ 'aria-label': c.close, title: c.close }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <DialogPanel>{children}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
