import type { FmEntry } from "../core/schema";
import type { FileManagerProps, FmFileAction } from "./file-manager";
import { FilesIcon, FolderInputIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DriveFolderPicker } from "./drive-folder-picker";
import { DriveShell } from "./drive-shell";
import { resolveFeatures } from "./features";
import { enLabels } from "./labels";
import { ManagerFrame } from "./manager-frame";
import { useFileManager } from "./use-file-manager";

export type FmDriveManagerProps = Omit<FileManagerProps, "layout" | "pick">;

/**
 * Cloud-drive presentation of the file manager: the folder tree on the left, the chosen
 * folder as a grid or list on the right, a batch bar for the selection, files open in
 * the preview dialog. Adds "Move to…" / "Copy to…" to the entry actions.
 */
export function DriveManager(props: FmDriveManagerProps) {
  const labels = props.labels ?? enLabels;
  const features = resolveFeatures(props.readOnly, props.features);
  const [picker, setPicker] = useState<{ mode: "move" | "copy"; entries: FmEntry[] }>();
  const actions = useMemo((): FmFileAction[] => [
    ...(props.actions ?? []),
    ...(features.move
      ? [
          {
            id: "moveTo",
            label: labels.moveTo,
            icon: <FolderInputIcon />,
            when: (es: FmEntry[]) => es.length > 0 && es.every(e => e.caps.move),
            run: (es: FmEntry[]) => setPicker({ mode: "move", entries: es }),
          },
        ]
      : []),
    ...(features.copy
      ? [
          {
            id: "copyTo",
            label: labels.copyTo,
            icon: <FilesIcon />,
            when: (es: FmEntry[]) => es.length > 0 && es.every(e => e.caps.copy),
            run: (es: FmEntry[]) => setPicker({ mode: "copy", entries: es }),
          },
        ]
      : []),
  ], [
    props.actions,
    labels,
    features.move,
    features.copy,
  ]);
  const p = { ...props, actions };
  const fm = useFileManager(p, "drive");
  const from = picker?.entries[0]?.mount;
  return (
    <ManagerFrame props={p} fm={fm}>
      <DriveShell props={p} fm={fm} />
      {picker && from && fm.shownMounts && (
        <DriveFolderPicker
          mode={picker.mode}
          entries={picker.entries}
          from={from}
          mounts={fm.shownMounts}
          client={fm.client}
          labels={labels}
          onClose={() => setPicker(undefined)}
          onPick={(to) => {
            setPicker(undefined);
            fm.runOps({
              op: picker.mode,
              paths: picker.entries.map(e => e.path),
              dest: to.path,
              ...(to.mount !== from
                ? { destMount: to.mount }
                : {}),
              conflict: "rename",
            }, undefined, from);
          }}
        />
      )}
    </ManagerFrame>
  );
}
