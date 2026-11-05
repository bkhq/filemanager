import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { makeXlsx } from "./sample-xlsx";

// 2x2 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEIGBgYGBgYAAA19gP9KmBDtQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));

const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 40 70 Td (File manager) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

export const SEED: Record<string, string | Uint8Array> = {
  "README.md": "# Local root\n\nFiles in this mount live on the local disk.\n",
  "samples/guide.md": "# Guide\n\nRead the [project page](https://github.com/bkhq/filemanager) first.\n\n| Port | Country |\n| --- | --- |\n| Piraeus | Greece |\n| Split | Croatia |\n\n- [x] Rendered view\n- [ ] Source view\n\n```ts\nconst greeting: string = \"hello\";\nconsole.log(greeting);\n```\n",
  "notes/todo.txt": "- try rename\n- try drag and drop\n",
  "notes/config.json": "{\n  \"region\": \"aegean\",\n  \"ports\": [\"Piraeus\", \"Mykonos\", \"Naxos\"]\n}\n",
  "images/dot.png": PNG,
  "docs/sample.pdf": PDF,
  "samples/hosts": "127.0.0.1 localhost\n::1 localhost\n",
  "samples/archive.zip": zipSync({
    "README.txt": new TextEncoder().encode("Files inside this archive are listed without extracting it.\n"),
    "src/main.ts": new TextEncoder().encode("export const answer = 42;\n"),
    "src/util/math.ts": new TextEncoder().encode("export const add = (a: number, b: number) => a + b;\n"),
    "images/dot.png": PNG,
  }),
  "samples/blob": Uint8Array.of(0x7F, 0x45, 0x4C, 0x46, 0, 1, 2, 0, 0, 0),
  "sheets/ports.csv": "port,country,berths\nPiraeus,Greece,670\nSplit,Croatia,350\n\"Valletta, Grand Harbour\",Malta,120\n",
  "sheets/fleet.xlsx": makeXlsx({
    Fleet: [
      ["Yacht", "Length (m)", "Home port"],
      ["Thalassa", 24, "Mykonos"],
      ["Adriana", 31, "Split"],
    ],
    Crew: [
      ["Name", "Role"],
      ["Nikos", "Captain"],
    ],
  }),
};

/** Fills an empty directory with sample files. */
export async function seedIfEmpty(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0)
    return;
  for (const [path, content] of Object.entries(SEED)) {
    const abs = join(root, path);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
}
