import type { PreviewProps } from "../react/previewers";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { useState } from "react";
import { FallbackPreview } from "../react/previewers";
import { columnName, parseSheet } from "./parse";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 1000;

/** Read-only table of a CSV / TSV / XLSX file with a tab per sheet. */
export function SheetPreview(props: PreviewProps) {
  const { entry, client, labels } = props;
  const [active, setActive] = useState(0);
  const tables = useQuery({
    queryKey: [
      "fm",
      client.baseUrl,
      "sheet",
      entry.mount,
      entry.path,
      entry.etag,
    ],
    enabled: entry.size <= MAX_BYTES,
    queryFn: async () => {
      const res = await client.read(entry.mount, entry.path, { version: entry.etag });
      return parseSheet(entry.name, await res.arrayBuffer());
    },
  });

  if (entry.size > MAX_BYTES)
    return <FallbackPreview {...props} message={labels.tooLargeToPreview} />;
  if (tables.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (tables.isError)
    return <FallbackPreview {...props} message={tables.error.message} />;

  const table = tables.data[Math.min(active, tables.data.length - 1)]!;
  const rows = table.rows.slice(0, MAX_ROWS);
  const width = Math.max(0, ...rows.map(r => r.length));

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 text-xs" aria-label={table.name}>
          <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 border-r border-b bg-muted px-2 py-1" />
              {Array.from({ length: width }, (_, c) => <th key={c} className="min-w-20 border-r border-b px-2 py-1 font-normal">{columnName(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              // eslint-disable-next-line react/no-array-index-key -- rows have no identity
              <tr key={r}>
                <th className="sticky left-0 border-r border-b bg-muted px-2 py-1 text-right font-normal text-muted-foreground tabular-nums">{r + 1}</th>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="max-w-80 truncate border-r border-b px-2 py-1" title={row[c]}>{row[c]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(tables.data.length > 1 || table.rows.length > MAX_ROWS) && (
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
          {table.rows.length > MAX_ROWS && <span className="ml-auto text-muted-foreground">{labels.sheetTruncated(MAX_ROWS, table.rows.length)}</span>}
        </div>
      )}
    </div>
  );
}
