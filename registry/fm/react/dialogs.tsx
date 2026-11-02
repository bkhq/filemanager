import type { FormEvent } from "react";
import type { Labels } from "./labels";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function NameDialog({ title, initial, submitLabel, labels, onSubmit, onClose }: {
  title: string;
  initial: string;
  submitLabel: string;
  labels: Labels;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim() !== "" && !/[/\\]/.test(name) && name !== "." && name !== "..";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid)
      onSubmit(name.trim());
  };
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={title}
            value={name}
            onChange={e => setName(e.target.value)}
            onFocus={(e) => {
              const dot = initial.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0
                ? dot
                : initial.length);
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{labels.cancel}</Button>
            <Button type="submit" disabled={!valid}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({ count, labels, onConfirm, onClose }: {
  count: number;
  labels: Labels;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.confirmDelete(count)}</AlertDialogTitle>
          <AlertDialogDescription>{labels.confirmDeleteHint}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>{labels.delete}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
