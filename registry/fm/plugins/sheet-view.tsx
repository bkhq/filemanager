import type { KeyboardEvent } from "react";
import type { PreviewProps } from "../react/previewers";
import type { FmSheetCell } from "./parse";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { PlusIcon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FmApiError } from "../client/client";
import { fmKeys } from "../client/hooks";
import { useChangeMessage } from "../react/change-message";
import { IconButton } from "../react/icon-button";
import { FallbackPreview } from "../react/previewers";
import { cellText, columnName, isNumeric, parseSheet, serializeCsv } from "./parse";

const MAX_BYTES = 20 * 1024 * 1024;
const ROW_H = 28;
const ROW_HEAD = 56;
const COL_W = 160;
const MIN_COL_W = 40;
const MAX_COL_W = 1000;
/** Arrow keys on a column edge resize by this. */
const COL_KEY_STEP = 16;

/** Unsaved CSV edits, against the version they started from. */
interface Draft {
  rows: string[][];
  baseEtag: string;
}

/**
 * Table of a CSV / TSV / XLSX file with a tab per sheet; rows are virtualized.
 * Writable CSV / TSV files are editable: double-click or Enter edits a cell.
 */
export function SheetPreview(props: PreviewProps) {
  const { entry, client, labels, actions, onDirtyChange } = props;
  const qc = useQueryClient();
  const [active, setActive] = useState(0);
  const tablesKey = [
    "fm",
    client.baseUrl,
    "sheet",
    entry.mount,
    entry.path,
    entry.etag,
  ];
  const tables = useQuery({
    queryKey: tablesKey,
    enabled: entry.size <= MAX_BYTES,
    queryFn: async () => {
      const res = await client.read(entry.mount, entry.path, { version: entry.etag });
      return parseSheet(entry.name, await res.arrayBuffer());
    },
  });
  const [draft, setDraft] = useState<Draft>();
  const { ask, used } = useChangeMessage();
  const [cursor, setCursor] = useState<{ r: number; c: number }>();
  const [editing, setEditing] = useState<{ r: number; c: number; value: string }>();
  const [saveError, setSaveError] = useState<{ conflict: boolean; message: string }>();
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Column widths per sheet, for this preview only. */
  const [widths, setWidths] = useState<Record<number, Record<number, number>>>({});

  const table = tables.data?.[Math.min(active, tables.data.length - 1)];
  const editable = !!table?.csv && entry.caps.write;
  const rows: FmSheetCell[][] = draft?.rows ?? table?.rows ?? [];
  const width = Math.max(1, ...rows.map(r => r.length));
  const dirty = !!draft;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => gridRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  if (entry.size > MAX_BYTES)
    return <FallbackPreview {...props} message={labels.tooLargeToPreview} />;
  if (tables.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (tables.isError || !table) {
    return (
      <FallbackPreview
        {...props}
        {...(tables.error
          ? { message: tables.error.message }
          : {})}
      />
    );
  }

  const change = (update: (rows: string[][]) => string[][]) => setDraft(d => ({
    rows: update((d?.rows ?? (table.rows as string[][])).map(r => [...r])),
    baseEtag: d?.baseEtag ?? entry.etag,
  }));
  const commit = (move?: { dr: number; dc: number }) => {
    if (!editing)
      return;
    const { r, c, value } = editing;
    if (String(rows[r]?.[c] ?? "") !== value) {
      change((all) => {
        while (all[r]!.length <= c) all[r]!.push("");
        all[r]![c] = value;
        return all;
      });
    }
    setEditing(undefined);
    const next = move && {
      r: Math.min(rows.length - 1, r + move.dr),
      c: Math.min(width - 1, c + move.dc),
    };
    setCursor(next ?? { r, c });
    gridRef.current?.focus();
  };
  const startEdit = (r: number, c: number) => {
    if (editable) {
      setEditing({
        r,
        c,
        value: String(rows[r]?.[c] ?? ""),
      });
    }
  };
  const moveCursor = (r: number, c: number) => {
    const next = {
      r: Math.max(0, Math.min(rows.length - 1, r)),
      c: Math.max(0, Math.min(width - 1, c)),
    };
    setCursor(next);
    virtualizer.scrollToIndex(next.r, { align: "auto" });
  };
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !cursor)
      return;
    const moves: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    };
    const m = moves[e.key];
    if (m)
      moveCursor(cursor.r + m[0], cursor.c + m[1]);
    else if ((e.key === "Enter" || e.key === "F2") && editable)
      startEdit(cursor.r, cursor.c);
    else
      return;
    e.preventDefault();
  };
  const save = async (ifMatch: string | undefined) => {
    if (!draft || !table.csv)
      return;
    const message = await ask();
    if (message === null)
      return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await client.write(entry.mount, entry.path, serializeCsv(draft.rows, table.csv), {
        message,
        ...(ifMatch
          ? { ifMatch }
          : {}),
      });
      used();
      setDraft(undefined);
      await qc.invalidateQueries({
        queryKey: fmKeys.lists(client, entry.mount),
      });
    }
    catch (err) {
      setSaveError({
        conflict: err instanceof FmApiError && err.status === 412,
        message: err instanceof Error
          ? err.message
          : String(err),
      });
    }
    finally {
      setSaving(false);
    }
  };
  const reload = () => {
    setDraft(undefined);
    setSaveError(undefined);
    void qc.invalidateQueries({
      queryKey: fmKeys.lists(client, entry.mount),
    });
    void tables.refetch();
  };

  const colW = (c: number) => widths[active]?.[c] ?? COL_W;
  const resizeColumn = (c: number, w: number) => setWidths(all => ({
    ...all,
    [active]: {
      ...all[active],
      [c]: Math.round(Math.min(MAX_COL_W, Math.max(MIN_COL_W, w))),
    },
  }));
  const colWidths = Array.from({ length: width }, (_, c) => colW(c));
  const columns = `${ROW_HEAD}px ${colWidths.map(w => `${w}px`).join(" ")}`;
  const cellClass = "truncate border-r border-b px-2 leading-[27px]";

  return (
    <div className="flex h-full flex-col">
      {editable && dirty && actions && createPortal(
        <>
          <span className="text-xs text-muted-foreground">{labels.unsaved}</span>
          <IconButton label={labels.save} disabled={saving} onClick={() => void save(draft.baseEtag)}><SaveIcon /></IconButton>
          <IconButton label={labels.discardEdits} onClick={() => setDraft(undefined)}><Undo2Icon /></IconButton>
        </>,
        actions,
      )}
      {saveError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs text-destructive">
          {saveError.conflict ? labels.conflict : saveError.message}
          {saveError.conflict && (
            <>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => void save(undefined)}>{labels.overwrite}</Button>
              <Button size="sm" variant="outline" onClick={reload}>{labels.reloadFromDisk}</Button>
            </>
          )}
        </div>
      )}
      <div
        ref={gridRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto text-xs outline-none"
        onKeyDown={onGridKeyDown}
      >
        <div role="table" aria-label={table.name} aria-rowcount={rows.length + 1} style={{ width: ROW_HEAD + colWidths.reduce((a, b) => a + b, 0) }}>
          <div role="row" className="sticky top-0 z-20 grid bg-muted text-muted-foreground" style={{ gridTemplateColumns: columns, height: ROW_H }}>
            <div role="columnheader" className="sticky left-0 z-10 border-r border-b bg-muted" />
            {Array.from({ length: width }, (_, c) => (
              <div key={c} role="columnheader" className={cn(cellClass, "relative text-center")}>
                {columnName(c)}
                {/* Drag or arrow keys resize the column; the keys stay off the grid's cursor. */}
                <div
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-label={labels.resizeColumn(columnName(c))}
                  aria-valuenow={colW(c)}
                  aria-valuemin={MIN_COL_W}
                  aria-valuemax={MAX_COL_W}
                  className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none outline-none hover:bg-primary/40 focus-visible:bg-primary/60"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.currentTarget.dataset.start = String(e.clientX - colW(c));
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      resizeColumn(c, e.clientX - Number(e.currentTarget.dataset.start));
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
                      return;
                    e.preventDefault();
                    e.stopPropagation();
                    resizeColumn(c, colW(c) + (e.key === "ArrowLeft"
                      ? -COL_KEY_STEP
                      : COL_KEY_STEP));
                  }}
                />
              </div>
            ))}
          </div>
          <div
            className="relative"
            style={{
              height: virtualizer.getTotalSize(),
            }}
          >
            {virtualizer.getVirtualItems().map((v) => {
              const r = v.index;
              const row = rows[r] ?? [];
              const head = (
                <div role="rowheader" className="sticky left-0 z-10 border-r border-b bg-muted px-2 text-right leading-[27px] text-muted-foreground tabular-nums">{r + 1}</div>
              );
              return (
                <div key={r} role="row" aria-rowindex={r + 2} className="absolute inset-x-0 top-0 grid" style={{ gridTemplateColumns: columns, height: ROW_H, transform: `translateY(${v.start}px)` }}>
                  {editable
                    ? (
                        <ContextMenu>
                          <ContextMenuTrigger render={head} />
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => change(all => all.filter((_, i) => i !== r))}>
                              <Trash2Icon />
                              {labels.deleteRow}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    : head}
                  {Array.from({ length: width }, (_, c) => {
                    const value = row[c];
                    const isCursor = cursor?.r === r && cursor.c === c;
                    if (editing?.r === r && editing.c === c) {
                      return (
                        <input
                          key={c}
                          autoFocus
                          aria-label={`${columnName(c)}${r + 1}`}
                          className="border-r border-b bg-background px-2 outline-2 -outline-offset-2 outline-primary"
                          value={editing.value}
                          onChange={e => setEditing({ ...editing, value: e.target.value })}
                          onBlur={() => commit()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commit({ dr: 1, dc: 0 });
                            }
                            else if (e.key === "Tab") {
                              e.preventDefault();
                              commit({ dr: 0, dc: 1 });
                            }
                            else if (e.key === "Escape") {
                              setEditing(undefined);
                              gridRef.current?.focus();
                            }
                          }}
                        />
                      );
                    }
                    return (
                      <div
                        key={c}
                        role="cell"
                        title={cellText(value)}
                        className={cn(cellClass, isNumeric(value) && "text-right tabular-nums", isCursor && "outline-2 -outline-offset-2 outline-primary")}
                        onClick={() => setCursor({ r, c })}
                        onDoubleClick={() => startEdit(r, c)}
                      >
                        {cellText(value)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {(tables.data.length > 1 || editable) && (
        <div className="flex items-center gap-1 border-t px-2 py-1 text-xs">
          {tables.data.length > 1 && tables.data.map((t, i) => (
            <button
              key={t.name}
              type="button"
              aria-pressed={i === active}
              className={cn("rounded-md px-2 py-1 hover:bg-muted", i === active && "bg-accent font-medium text-accent-foreground")}
              onClick={() => setActive(i)}
            >
              {t.name}
            </button>
          ))}
          {editable && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                change(all => [
                  ...all,
                  Array.from<string>({ length: width }).fill(""),
                ]);
                requestAnimationFrame(() => moveCursor(rows.length, 0));
              }}
            >
              <PlusIcon />
              {labels.addRow}
            </Button>
          )}
          <span className="ml-auto text-muted-foreground tabular-nums">{labels.sheetRows(rows.length)}</span>
        </div>
      )}
    </div>
  );
}
