import type { FmConflict } from "../core/schema";
import type { FmClient } from "./client";
import { createStore } from "zustand/vanilla";
import { FmApiError } from "./client";

export type FmUploadStatus = "queued" | "uploading" | "done" | "error" | "canceled";

export interface FmUploadTask {
  id: string;
  mount: string;
  /** Requested target path; the server may pick a free name. */
  path: string;
  name: string;
  /** What the server does when `path` exists. */
  conflict: FmConflict;
  size: number;
  loaded: number;
  status: FmUploadStatus;
  error?: string;
}

export interface FmUploadFile {
  file: Blob & { name: string };
  /** Path below the target directory, e.g. `photos/a.jpg` for folder uploads. */
  relativePath?: string;
  /** Defaults to `rename` (keep both). */
  conflict?: FmConflict;
}

export type FmTransport = (task: FmUploadTask, file: Blob, onProgress: (loaded: number) => void, signal: AbortSignal) => Promise<void>;

export interface FmUploadState {
  tasks: FmUploadTask[];
  enqueue: (mount: string, dir: string, files: FmUploadFile[]) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

/** PUT via XHR so byte progress is observable (fetch cannot report upload progress). */
export function xhrTransport(client: FmClient): FmTransport {
  return (task, file, onProgress, signal) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", client.writeUrl(task.mount, task.path, task.conflict));
    for (const [k, v] of Object.entries(client.headers()))
      xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300)
        return resolve();
      let body: { error?: { code?: string; message?: string } } | undefined;
      try {
        body = JSON.parse(xhr.responseText);
      }
      catch {}
      reject(new FmApiError(xhr.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? xhr.statusText));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

export interface FmUploadQueueOptions {
  transport: FmTransport;
  concurrency?: number;
  /** Called after each successful upload (e.g. to refresh listings). */
  onUploaded?: (task: FmUploadTask) => void;
}

export function createUploadQueue(opts: FmUploadQueueOptions) {
  const concurrency = opts.concurrency ?? 3;
  const files = new Map<string, Blob>();
  const controllers = new Map<string, AbortController>();
  let seq = 0;

  const store = createStore<FmUploadState>()((set, get) => {
    const patch = (id: string, p: Partial<FmUploadTask>) =>
      set(s => ({
        tasks: s.tasks.map(t => (t.id === id
          ? {
              ...t,
              ...p,
            }
          : t)),
      }));

    function pump() {
      const { tasks } = get();
      let running = tasks.filter(t => t.status === "uploading").length;
      for (const task of tasks) {
        if (running >= concurrency)
          break;
        if (task.status === "queued") {
          running++;
          void run(task);
        }
      }
    }

    async function run(task: FmUploadTask) {
      const controller = new AbortController();
      controllers.set(task.id, controller);
      patch(task.id, { status: "uploading" });
      try {
        await opts.transport(task, files.get(task.id)!, loaded => patch(task.id, { loaded }), controller.signal);
        patch(task.id, { status: "done", loaded: task.size });
        opts.onUploaded?.(task);
      }
      catch (err) {
        if (controller.signal.aborted) {
          patch(task.id, { status: "canceled" });
        }
        else {
          patch(task.id, {
            status: "error",
            error: err instanceof Error
              ? err.message
              : String(err),
          });
        }
      }
      finally {
        controllers.delete(task.id);
        files.delete(task.id);
        pump();
      }
    }

    return {
      tasks: [],
      enqueue: (mount, dir, list) => {
        const added = list.map(({ file, relativePath, conflict }): FmUploadTask => {
          const id = `u${++seq}`;
          files.set(id, file);
          const rel = (relativePath || file.name).replace(/^\/+/, "");
          return {
            id,
            mount,
            path: `${dir === "/"
              ? ""
              : dir}/${rel}`,
            name: file.name,
            conflict: conflict ?? "rename",
            size: file.size,
            loaded: 0,
            status: "queued",
          };
        });
        set(s => ({
          tasks: [
            ...s.tasks,
            ...added,
          ],
        }));
        pump();
      },
      cancel: (id) => {
        const task = get().tasks.find(t => t.id === id);
        if (task?.status === "queued") {
          files.delete(id);
          patch(id, { status: "canceled" });
        }
        controllers.get(id)?.abort();
      },
      clearFinished: () => set(s => ({
        tasks: s.tasks.filter(t => t.status === "queued" || t.status === "uploading"),
      })),
    };
  });
  return store;
}

export type FmUploadQueue = ReturnType<typeof createUploadQueue>;
