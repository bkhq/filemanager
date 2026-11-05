import { describe, expect, it } from "bun:test";
import { makeXlsx } from "../../../apps/fm-api/src/sample-xlsx";
import { cellText, columnName, isNumeric, parseSheet, serializeCsv } from "./parse";

const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const text = (s: string) => buf(new TextEncoder().encode(s));

describe("sheet parsing", () => {
  it("parses csv with quotes and tsv, keeping the format", async () => {
    expect(await parseSheet("a.csv", text("name,port\r\n\"Aegean, Ltd\",Piraeus\r\n\r\n"))).toEqual([
      {
        name: "a.csv",
        rows: [
          ["name", "port"],
          ["Aegean, Ltd", "Piraeus"],
        ],
        csv: { delimiter: ",", newline: "\r\n", trailingNewline: true },
      },
    ]);
    const tsv = (await parseSheet("a.tsv", text("a\tb\n1\t2")))[0]!;
    expect(tsv.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(tsv.csv).toEqual({ delimiter: "\t", newline: "\n", trailingNewline: false });
  });

  it("parses every xlsx sheet with typed cells", async () => {
    const tables = await parseSheet("f.xlsx", buf(makeXlsx({
      Fleet: [
        ["Yacht", "Length"],
        ["Thalassa", 24],
      ],
      Ports: [
        ["Split"],
      ],
    })));
    expect(tables).toEqual([
      {
        name: "Fleet",
        rows: [
          ["Yacht", "Length"],
          ["Thalassa", 24],
        ],
      },
      {
        name: "Ports",
        rows: [
          ["Split"],
        ],
      },
    ]);
  });

  it("names columns like a spreadsheet", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});

describe("cells", () => {
  it("detects numbers in typed and text cells", () => {
    expect([
      24,
      "42",
      "-1.5",
      "1e3",
      " 7 ",
      "1,000",
      "abc",
      "",
      true,
    ].map(isNumeric)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("shows dates without a midnight time", () => {
    const day = new Date(Date.UTC(2026, 0, 2));
    const time = new Date(Date.UTC(2026, 0, 2, 13, 30));
    expect(cellText(day)).toBe(day.toLocaleDateString(undefined, { timeZone: "UTC" }));
    expect(cellText(time)).toBe(time.toLocaleString(undefined, { timeZone: "UTC" }));
    expect(cellText(undefined)).toBe("");
    expect(cellText(3.5)).toBe("3.5");
  });

  it("writes csv back in the source format", async () => {
    const source = "name;note\r\nA;\"x;y\"\r\n";
    const table = (await parseSheet("a.csv", text(source)))[0]!;
    expect(table.csv?.delimiter).toBe(";");
    expect(serializeCsv(table.rows as string[][], table.csv!)).toBe(source);
    expect(serializeCsv([
      ["a", "b"],
      ["1", "line\nbreak"],
    ], { delimiter: ",", newline: "\n", trailingNewline: false })).toBe("a,b\n1,\"line\nbreak\"");
  });
});
