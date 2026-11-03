import { describe, expect, it } from "bun:test";
import { makeXlsx } from "../../../apps/demo-api/src/sample-xlsx";
import { columnName, parseSheet } from "./parse";

const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const text = (s: string) => buf(new TextEncoder().encode(s));

describe("sheet parsing", () => {
  it("parses csv with quotes and tsv", async () => {
    expect(await parseSheet("a.csv", text("name,port\n\"Aegean, Ltd\",Piraeus\n\n"))).toEqual([
      {
        name: "a.csv",
        rows: [
          ["name", "port"],
          ["Aegean, Ltd", "Piraeus"],
        ],
      },
    ]);
    expect((await parseSheet("a.tsv", text("a\tb\n1\t2\n")))[0]!.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("parses every xlsx sheet", async () => {
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
          ["Thalassa", "24"],
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
