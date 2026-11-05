import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";

/** A cell as parsed: CSV / TSV cells are text, XLSX keeps numbers, booleans and dates. */
export type FmSheetCell = string | number | boolean | Date;

/** Source format of a CSV / TSV table, kept when it is written back. */
export interface FmCsvFormat {
  delimiter: string;
  newline: string;
  trailingNewline: boolean;
}

export interface FmSheetTable {
  name: string;
  rows: FmSheetCell[][];
  /** Set for CSV / TSV (editable); absent for XLSX sheets. */
  csv?: FmCsvFormat;
}

const NUMBER = /^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?\s*$/i;

/** Numbers right-align: typed numbers and text that reads as one. */
export function isNumeric(value: FmSheetCell | undefined): boolean {
  return typeof value === "number" || (typeof value === "string" && NUMBER.test(value));
}

/** Display text; dates without a time of day show as dates (XLSX dates are UTC). */
export function cellText(value: FmSheetCell | undefined): string {
  if (value === undefined || value === null)
    return "";
  if (value instanceof Date) {
    const midnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
    return midnight
      ? value.toLocaleDateString(undefined, { timeZone: "UTC" })
      : value.toLocaleString(undefined, { timeZone: "UTC" });
  }
  return String(value);
}

/** Parses a CSV / TSV / XLSX file into tables (one per sheet). */
export async function parseSheet(name: string, bytes: ArrayBuffer): Promise<FmSheetTable[]> {
  if (/\.xlsx$/i.test(name)) {
    const sheets = await readXlsxFile(bytes);
    return sheets.map(s => ({
      name: s.sheet,
      rows: s.data.map(row => row.map(v => (v === null || v === undefined
        ? ""
        : v as FmSheetCell))),
    }));
  }
  const source = new TextDecoder().decode(bytes);
  const parsed = Papa.parse<string[]>(source, {
    skipEmptyLines: "greedy",
    ...(/\.tsv$/i.test(name)
      ? { delimiter: "\t" }
      : {}),
  });
  return [
    {
      name,
      rows: parsed.data,
      csv: {
        delimiter: parsed.meta.delimiter,
        newline: parsed.meta.linebreak,
        trailingNewline: /\r?\n$/.test(source),
      },
    },
  ];
}

/** CSV / TSV text of `rows` in the source format. */
export function serializeCsv(rows: readonly (readonly string[])[], f: FmCsvFormat): string {
  const out = Papa.unparse(rows as string[][], { delimiter: f.delimiter, newline: f.newline });
  return f.trailingNewline
    ? out + f.newline
    : out;
}

/** Spreadsheet column name: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
