import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";

export interface FmSheetTable {
  name: string;
  rows: string[][];
}

function cell(value: unknown): string {
  if (value === null || value === undefined)
    return "";
  if (value instanceof Date)
    return value.toLocaleString();
  return String(value);
}

/** Parses a CSV / TSV / XLSX file into string tables (one per sheet). */
export async function parseSheet(name: string, bytes: ArrayBuffer): Promise<FmSheetTable[]> {
  if (/\.xlsx$/i.test(name)) {
    const sheets = await readXlsxFile(bytes);
    return sheets.map(s => ({
      name: s.sheet,
      rows: s.data.map(row => row.map(cell)),
    }));
  }
  const parsed = Papa.parse<string[]>(new TextDecoder().decode(bytes), {
    skipEmptyLines: "greedy",
    ...(/\.tsv$/i.test(name)
      ? { delimiter: "\t" }
      : {}),
  });
  return [
    { name, rows: parsed.data },
  ];
}

/** Spreadsheet column name: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
