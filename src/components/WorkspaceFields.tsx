import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { X } from "@phosphor-icons/react";

interface ModalFrameProps {
  heading: string;
  description?: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function ModalFrame({ heading, description, busy, onClose, children, footer }: ModalFrameProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-32px)] max-w-[500px] flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader className="relative shrink-0 px-6 pt-6 pr-14 text-left">
          <DialogTitle>{heading}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
          <Button type="button" variant="ghost" size="icon-sm" className="absolute top-5 right-6" onClick={onClose} disabled={busy} aria-label="关闭"><X size={15} /></Button>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

export function PathPickerField({ id, label, value, placeholder, error, busy, autoFocus, onChange, onBrowse }: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error?: string;
  busy: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onBrowse: () => void;
}) {
  return <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <InputGroup>
      <InputGroupInput id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} autoFocus={autoFocus} disabled={busy} />
      <InputGroupAddon align="inline-end"><InputGroupButton onClick={onBrowse} disabled={busy}>浏览</InputGroupButton></InputGroupAddon>
    </InputGroup>
    {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}
