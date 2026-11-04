import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { clearDraft, clearDrafts, FM_DRAFT_MAX_CHARS, FM_DRAFT_MAX_ENTRIES, loadDraft, saveDraft } from "./drafts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: k => data.get(k) ?? null,
    key: i => [
      ...data.keys(),
    ][i] ?? null,
    removeItem: k => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

afterEach(() => {
  setSystemTime();
});

describe("drafts", () => {
  it("round-trips a draft and misses unknown files", () => {
    const s = memoryStorage();
    setSystemTime(new Date(1000));
    saveDraft("local", "/a.txt", { text: "hi", etag: "e1" }, s);
    expect(loadDraft("local", "/a.txt", s)).toEqual({ text: "hi", etag: "e1", savedAt: 1000 });
    expect(loadDraft("local", "/b.txt", s)).toBeUndefined();
    expect(loadDraft("other", "/a.txt", s)).toBeUndefined();
  });

  it("overwrites text, etag and savedAt", () => {
    const s = memoryStorage();
    setSystemTime(new Date(1000));
    saveDraft("local", "/a.txt", { text: "one", etag: "e1" }, s);
    setSystemTime(new Date(2000));
    saveDraft("local", "/a.txt", { text: "two", etag: "e2" }, s);
    expect(loadDraft("local", "/a.txt", s)).toEqual({ text: "two", etag: "e2", savedAt: 2000 });
  });

  it("drops the oldest draft past the entry limit", () => {
    const s = memoryStorage();
    for (let i = 0; i <= FM_DRAFT_MAX_ENTRIES; i++) {
      setSystemTime(new Date(1000 + i));
      saveDraft("local", `/f${i}`, { text: "x", etag: "" }, s);
    }
    expect(loadDraft("local", "/f0", s)).toBeUndefined();
    expect(loadDraft("local", "/f1", s)?.text).toBe("x");
    expect(loadDraft("local", `/f${FM_DRAFT_MAX_ENTRIES}`, s)?.text).toBe("x");
  });

  it("drops the oldest drafts past the char limit", () => {
    const s = memoryStorage();
    const third = "x".repeat(Math.floor(FM_DRAFT_MAX_CHARS / 3));
    for (let i = 0; i < 4; i++) {
      setSystemTime(new Date(1000 + i));
      saveDraft("local", `/f${i}`, { text: third, etag: "" }, s);
    }
    expect(loadDraft("local", "/f0", s)).toBeUndefined();
    for (let i = 1; i < 4; i++)
      expect(loadDraft("local", `/f${i}`, s)).toBeDefined();
  });

  it("does not store an oversize draft and drops the older one", () => {
    const s = memoryStorage();
    saveDraft("local", "/a.txt", { text: "small", etag: "" }, s);
    saveDraft("local", "/b.txt", { text: "keep", etag: "" }, s);
    saveDraft("local", "/a.txt", {
      text: "x".repeat(FM_DRAFT_MAX_CHARS + 1),
      etag: "",
    }, s);
    expect(loadDraft("local", "/a.txt", s)).toBeUndefined();
    expect(loadDraft("local", "/b.txt", s)?.text).toBe("keep");
  });

  it("clears one draft", () => {
    const s = memoryStorage();
    saveDraft("local", "/a.txt", { text: "a", etag: "" }, s);
    saveDraft("local", "/b.txt", { text: "b", etag: "" }, s);
    clearDraft("local", "/a.txt", s);
    expect(loadDraft("local", "/a.txt", s)).toBeUndefined();
    expect(loadDraft("local", "/b.txt", s)?.text).toBe("b");
  });

  it("clears drafts by path prefix", () => {
    const s = memoryStorage();
    for (const p of ["/a", "/a/b.txt", "/ab.txt"])
      saveDraft("local", p, { text: p, etag: "" }, s);
    saveDraft("other", "/a/b.txt", { text: "o", etag: "" }, s);
    clearDrafts("local", "/a", s);
    expect(loadDraft("local", "/a", s)).toBeUndefined();
    expect(loadDraft("local", "/a/b.txt", s)).toBeUndefined();
    expect(loadDraft("local", "/ab.txt", s)?.text).toBe("/ab.txt");
    expect(loadDraft("other", "/a/b.txt", s)?.text).toBe("o");
    clearDrafts("local", "/", s);
    expect(loadDraft("local", "/ab.txt", s)).toBeUndefined();
    expect(loadDraft("other", "/a/b.txt", s)?.text).toBe("o");
  });

  it("treats corrupt or foreign JSON as empty", () => {
    const s = memoryStorage();
    for (const raw of [
      "{not json",
      "[1,2]",
      "42",
      "{\"local:/a\":{\"text\":1}}",
    ]) {
      s.setItem("fm:drafts", raw);
      expect(loadDraft("local", "/a", s)).toBeUndefined();
      saveDraft("local", "/a", { text: "ok", etag: "" }, s);
      expect(loadDraft("local", "/a", s)?.text).toBe("ok");
    }
  });

  it("swallows storage write errors", () => {
    const s = memoryStorage();
    s.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => saveDraft("local", "/a", { text: "x", etag: "" }, s)).not.toThrow();
    expect(() => clearDrafts("local", "/", s)).not.toThrow();
  });

  it("retries a failed write with the oldest half dropped", () => {
    const s = memoryStorage();
    for (let i = 0; i < 4; i++) {
      setSystemTime(new Date(1000 + i));
      saveDraft("local", `/f${i}`, { text: "x", etag: "" }, s);
    }
    const set = s.setItem.bind(s);
    let calls = 0;
    s.setItem = (k, v) => {
      if (calls++ === 0)
        throw new Error("QuotaExceededError");
      set(k, v);
    };
    setSystemTime(new Date(2000));
    saveDraft("local", "/f4", { text: "x", etag: "" }, s);
    expect(loadDraft("local", "/f0", s)).toBeUndefined();
    expect(loadDraft("local", "/f1", s)).toBeUndefined();
    expect(loadDraft("local", "/f4", s)).toBeDefined();
  });
});
