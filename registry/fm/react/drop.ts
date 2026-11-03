import type { FmUploadFile } from "../client/upload";

const isFile = (e: FileSystemEntry): e is FileSystemFileEntry => e.isFile;
const isDir = (e: FileSystemEntry): e is FileSystemDirectoryEntry => e.isDirectory;

async function walk(entry: FileSystemEntry, out: FmUploadFile[]): Promise<void> {
  if (isFile(entry)) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    out.push({
      file,
      relativePath: entry.fullPath.replace(/^\//, ""),
    });
    return;
  }
  if (!isDir(entry))
    return;
  const reader = entry.createReader();
  // readEntries returns batches until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0)
      return;
    for (const child of batch)
      await walk(child, out);
  }
}

/**
 * Files from a drop event, recursing into dropped folders. Call it synchronously
 * inside the drop handler: the entries are only readable during the event.
 */
export async function filesFromDrop(dt: DataTransfer): Promise<FmUploadFile[]> {
  const entries = [...dt.items]
    .map(item => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0)
    return [...dt.files].map(file => ({ file }));
  const out: FmUploadFile[] = [];
  for (const e of entries)
    await walk(e, out);
  return out;
}

/** Files from an `<input type=file>`, keeping folder structure for `webkitdirectory` inputs. */
export function filesFromInput(list: FileList): FmUploadFile[] {
  return [...list].map(file => ({ file, relativePath: file.webkitRelativePath || file.name }));
}
