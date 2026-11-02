import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// 2x2 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEIGBgYGBgYAAA19gP9KmBDtQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));

const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 40 70 Td (File manager demo) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

export const SEED: Record<string, string | Uint8Array> = {
  "README.md": "# Demo root\n\nFiles in this mount live on the local disk.\n",
  "notes/todo.txt": "- try rename\n- try drag and drop\n",
  "notes/config.json": "{\n  \"region\": \"aegean\",\n  \"ports\": [\"Piraeus\", \"Mykonos\", \"Naxos\"]\n}\n",
  "images/dot.png": PNG,
  "docs/sample.pdf": PDF,
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
