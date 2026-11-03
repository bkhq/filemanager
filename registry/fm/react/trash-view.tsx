import type { FmClient } from "../client/client";
import type { FmOpsResult, FmTrashItem } from "../core/schema";
import type { FmLabels } from "./labels";
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useFmMutations, useTrash } from "../client/hooks";
import { dirname } from "../core/path";
import { ConfirmDeleteDialog } from "./dialogs";
import { EntryIcon } from "./file-list";
import { IconButton } from "./icon-button";
import { formatSize } from "./state";

/** Contents of a mount's trash with restore / delete-forever per item. */
export function TrashView({ mount, mountLabel, client, labels, onError, onRestored }: {
  mount: string;
  mountLabel: string;
  client: FmClient;
  labels: FmLabels;
  onError: (message: string | undefined) => void;
  onRestored: (count: number) => void;
}) {
  const trash = useTrash(client, mount);
  const { restore, purge } = useFmMutations(client, mount);
  const [confirm, setConfirm] = useState<string[]>();
  const items = trash.data ?? [];

  const report = (res: FmOpsResult) => {
    const failed = res.results.filter(r => !r.ok);
    onError(failed.length
      ? `${labels.failed(failed.length)}: ${failed[0]!.error?.message ?? ""}`
      : undefined);
    return res.results.length - failed.length;
  };
  const onRestore = (item: FmTrashItem) => restore.mutate([item.id], {
    onSuccess: res => onRestored(report(res)),
    onError: e => onError(e.message),
  });

  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
        {trash.isPending ? labels.loading : labels.trashIsEmpty}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
          <tr className="border-b text-left">
            <th className="px-3 py-1.5 font-normal">{labels.name}</th>
            <th className="px-3 py-1.5 font-normal">{labels.originalLocation}</th>
            <th className="px-3 py-1.5 font-normal">{labels.deletedAt}</th>
            <th className="px-3 py-1.5 text-right font-normal">{labels.size}</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="border-b last:border-0 hover:bg-muted/50" data-trash-id={item.id}>
              <td className="px-3 py-1">
                <span className="flex items-center gap-2">
                  <EntryIcon entry={item} className="size-4" />
                  <span className="truncate">{item.name}</span>
                </span>
              </td>
              <td className="truncate px-3 py-1 text-muted-foreground">
                {`${mountLabel}${dirname(item.path) === "/"
                  ? ""
                  : dirname(item.path)}`}
              </td>
              <td className="px-3 py-1 text-muted-foreground">{new Date(item.deletedAt).toLocaleString()}</td>
              <td className="px-3 py-1 text-right text-muted-foreground tabular-nums">
                {item.kind === "file"
                  ? formatSize(item.size)
                  : "—"}
              </td>
              <td className="px-2 py-1">
                <span className="flex justify-end gap-1">
                  <IconButton size="icon-xs" label={labels.restore} onClick={() => onRestore(item)}><ArchiveRestoreIcon /></IconButton>
                  <IconButton size="icon-xs" label={labels.deleteForever} onClick={() => setConfirm([item.id])}><Trash2Icon /></IconButton>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confirm && (
        <ConfirmDeleteDialog
          count={confirm.length}
          labels={labels}
          onClose={() => setConfirm(undefined)}
          onConfirm={() => {
            setConfirm(undefined);
            purge.mutate(confirm, {
              onSuccess: report,
              onError: e => onError(e.message),
            });
          }}
        />
      )}
    </div>
  );
}
