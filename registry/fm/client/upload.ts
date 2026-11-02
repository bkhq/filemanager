import type { FmClient } from "./client";
import { createStore } from "zustand/vanilla";
import { FmApiError } from "./client";

export type UploadStatus = "queued" | "uploading" | "done" | "error" | "canceled";

export interface UploadTask {
  id: string;
  mount: string;
  /** Requested target path; the server may pick a free name. */
  path: string;
  name: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  error?: string;
}

export interface UploadFile {
  file: Blob & { name: string };
  /** Path below the target directory, e.g. `photos/a.jpg` for folder uploads. */
  relativePath?: string;
}

export type Transport = (task: UploadTask, file: Blob, onProgress: (loaded: number) => void, signal: AbortSignal) => Promise<void>;

export interface UploadState {
  tasks: UploadTask[];
  enqueue: (mount: string, dir: string, files: UploadFile[]) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

/** PUT via XHR so byte progress is observable (fetch cannot report upload progress). */
export function xhrTransport(client: FmClient): Transport {
  return (task, file, onProgress, signal) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", client.writeUrl(task.mount, task.path, "rename"));
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

export interface UploadQueueOptions {
  transport: Transport;
  concurrency?: number;
  /** Called after each successful upload (e.g. to refresh listings). */
  onUploaded?: (task: UploadTask) => void;
}

export function createUploadQueue(opts: UploadQueueOptions) {
  const concurrency = opts.concurrency ?? 3;
  const files = new Map<string, Blob>();
  const controllers = new Map<string, AbortController>();
  let seq = 0;

  const store = createStore<UploadState>()((set, get) => {
    const patch = (id: string, p: Partial<UploadTask>) =>
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

    async function run(task: UploadTask) {
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
        const added = list.map(({ file, relativePath }): UploadTask => {
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

export type UploadQueue = ReturnType<typeof createUploadQueue>;
