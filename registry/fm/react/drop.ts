import type { FileWithPath } from "react-dropzone";
import type { FmUploadFile } from "../client/upload";

/** Files from react-dropzone; dropped folders keep their path below the drop ("docs/a.txt"). */
export function filesFromDropzone(files: readonly (File & Partial<Pick<FileWithPath, "path" | "relativePath">>)[]): FmUploadFile[] {
  return files.map(file => ({
    file,
    relativePath: (file.relativePath || file.path || file.name).replace(/^\.?\//, ""),
  }));
}

export function filesFromInput(list: FileList): FmUploadFile[] {
  return [...list].map(file => ({ file, relativePath: file.webkitRelativePath || file.name }));
}
