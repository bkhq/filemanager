import type { FmS3DriverOptions } from "./s3";
import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { AwsClient } from "aws4fetch";
import { runDriverContract } from "../server/contract";
import { readAll } from "../server/driver";
import { parseList, parseParts, s3Driver } from "./s3";

describe("parseList", () => {
  it("decodes url-encoded keys, entities and pagination", () => {
    const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;1</NextContinuationToken>
      <Contents><Key>a%2Fb+c%2Bd.txt</Key><LastModified>2026-01-02T03:04:05.000Z</LastModified><ETag>&quot;abc&quot;</ETag><Size>7</Size></Contents>
      <CommonPrefixes><Prefix>dir%C3%A9%2F</Prefix></CommonPrefixes></ListBucketResult>`;
    expect(parseList(xml)).toEqual({
      objects: [
        {
          key: "a/b c+d.txt",
          size: 7,
          mtime: Date.parse("2026-01-02T03:04:05.000Z"),
          etag: "abc",
        },
      ],
      prefixes: ["diré/"],
      next: "t&1",
    });
  });
});

describe("parseParts", () => {
  it("reads parts, entities and pagination", () => {
    const xml = `<ListPartsResult><UploadId>u</UploadId><IsTruncated>true</IsTruncated><NextPartNumberMarker>2</NextPartNumberMarker>
      <Part><PartNumber>1</PartNumber><LastModified>2026-01-02T03:04:05.000Z</LastModified><ETag>&quot;a1&quot;</ETag><Size>5242880</Size></Part>
      <Part><PartNumber>2</PartNumber><ETag>"b2"</ETag><Size>3</Size></Part></ListPartsResult>`;
    expect(parseParts(xml)).toEqual({
      parts: [
        { n: 1, size: 5242880, etag: "a1" },
        { n: 2, size: 3, etag: "b2" },
      ],
      next: 2,
    });
    expect(parseParts("<ListPartsResult><IsTruncated>false</IsTruncated></ListPartsResult>")).toEqual({ parts: [] });
  });
});

const GiB = 1024 ** 3;

interface FakeRequest {
  method: string;
  key: string;
  query: URLSearchParams;
  headers: Headers;
  body: string;
}

/** In-memory S3 behind a mocked `fetch`; `respond` may override any request. */
function fakeS3(objects: Record<string, number>, respond?: (r: FakeRequest) => Response | undefined) {
  const store = new Map(Object.entries(objects));
  const requests: FakeRequest[] = [];
  const xml = (body: string) => new Response(body, {
    headers: { "content-type": "application/xml" },
  });
  spyOn(globalThis, "fetch").mockImplementation((async (input: Request) => {
    const url = new URL(input.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/bucket\/?/, ""));
    const r: FakeRequest = {
      method: input.method,
      key,
      query: url.searchParams,
      headers: input.headers,
      body: await input.text(),
    };
    requests.push(r);
    const override = respond?.(r);
    if (override)
      return override;
    const q = url.searchParams;
    if (r.method === "GET" && q.get("list-type")) {
      const prefix = q.get("prefix") ?? "";
      const keys = [
        ...store.keys(),
      ].filter(k => k.startsWith(prefix)).slice(0, Number(q.get("max-keys") ?? 1000));
      return xml(`<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map(k =>
        `<Contents><Key>${encodeURIComponent(k)}</Key><Size>${store.get(k)}</Size><ETag>"e"</ETag></Contents>`).join("")}</ListBucketResult>`);
    }
    if (r.method === "HEAD") {
      const size = store.get(key);
      return size === undefined
        ? new Response(null, { status: 404 })
        : new Response(null, {
            headers: {
              "content-length": String(size),
              "content-type": "video/mp4",
              "etag": "\"e\"",
            },
          });
    }
    if (r.method === "POST" && q.has("uploads"))
      return xml("<InitiateMultipartUploadResult><UploadId>up1</UploadId></InitiateMultipartUploadResult>");
    if (r.method === "PUT" && q.has("partNumber"))
      return xml(`<CopyPartResult><ETag>&quot;p${q.get("partNumber")}&quot;</ETag></CopyPartResult>`);
    if (r.method === "POST" && q.has("uploadId")) {
      store.set(key, 1);
      return xml("<CompleteMultipartUploadResult><ETag>\"c\"</ETag></CompleteMultipartUploadResult>");
    }
    if (r.method === "DELETE") {
      if (!q.has("uploadId"))
        store.delete(key);
      return new Response(null, { status: 204 });
    }
    if (r.method === "PUT" && r.headers.get("x-amz-copy-source")) {
      const from = decodeURIComponent(r.headers.get("x-amz-copy-source")!.replace(/^\/bucket\//, ""));
      store.set(key, store.get(from) ?? 0);
      return xml("<CopyObjectResult><ETag>\"c\"</ETag></CopyObjectResult>");
    }
    if (r.method === "PUT") {
      store.set(key, r.body.length);
      return new Response(null, {
        headers: { etag: "\"e\"" },
      });
    }
    throw new Error(`unexpected ${r.method} ${input.url}`);
  }) as unknown as typeof fetch);
  const driver = s3Driver({
    endpoint: "http://s3.test",
    bucket: "bucket",
    accessKeyId: "k",
    secretAccessKey: "s",
  });
  return { driver, store, requests };
}

describe("s3Driver copies (mocked fetch)", () => {
  afterEach(() => {
    (globalThis.fetch as unknown as { mockRestore: () => void }).mockRestore();
  });

  it("copies an object over 5 GiB with a multipart copy", async () => {
    const size = 6 * GiB + 1;
    const { driver, requests } = fakeS3({ "big.bin": size });
    await driver.copy("/big.bin", "/copy.bin");
    expect(requests.some(r => r.method === "PUT" && !r.query.has("partNumber"))).toBe(false);
    const create = requests.find(r => r.method === "POST" && r.query.has("uploads"));
    expect(create?.key).toBe("copy.bin");
    expect(create?.headers.get("content-type")).toBe("video/mp4");
    const parts = requests.filter(r => r.method === "PUT" && r.query.has("partNumber"))
      .sort((a, b) => Number(a.query.get("partNumber")) - Number(b.query.get("partNumber")));
    const partSize = 512 * 1024 * 1024;
    expect(parts.map(r => r.query.get("partNumber"))).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)));
    expect(parts.map(r => r.headers.get("x-amz-copy-source-range"))).toEqual(Array.from({ length: 13 }, (_, i) =>
      `bytes=${i * partSize}-${Math.min((i + 1) * partSize, size) - 1}`));
    expect(parts.every(r => r.query.get("uploadId") === "up1" && r.headers.get("x-amz-copy-source") === "/bucket/big.bin")).toBe(true);
    const complete = requests.filter(r => r.method === "POST" && r.query.get("uploadId") === "up1");
    expect(complete).toHaveLength(1);
    expect(complete[0]!.body).toBe(`<CompleteMultipartUpload>${Array.from({ length: 13 }, (_, i) =>
      `<Part><PartNumber>${i + 1}</PartNumber><ETag>"p${i + 1}"</ETag></Part>`).join("")}</CompleteMultipartUpload>`);
  });

  it("aborts a multipart copy whose part copy fails", async () => {
    const { driver, requests, store } = fakeS3({ "big.bin": 6 * GiB }, r =>
      r.query.get("partNumber") === "3"
        ? new Response("<Error><Code>InternalError</Code><Message>boom</Message></Error>")
        : undefined);
    await expect(driver.copy("/big.bin", "/copy.bin")).rejects.toThrow(/InternalError/);
    expect(requests.some(r => r.method === "DELETE" && r.query.get("uploadId") === "up1")).toBe(true);
    expect(requests.some(r => r.method === "POST" && r.query.get("uploadId") === "up1")).toBe(false);
    expect([
      ...store.keys(),
    ]).toEqual(["big.bin"]);
  });

  it("rejects a 200 CopyObject response carrying an <Error> body", async () => {
    const { driver } = fakeS3({ "a.txt": 1 }, r =>
      r.method === "PUT" && r.headers.get("x-amz-copy-source")
        ? new Response("<Error><Code>InternalError</Code><Message>boom</Message></Error>")
        : undefined);
    await expect(driver.copy("/a.txt", "/b.txt")).rejects.toThrow(/InternalError/);
  });

  it("rolls back a folder move whose copy fails midway", async () => {
    const { driver, store, requests } = fakeS3({ "d/a.txt": 1, "d/b.txt": 1, "d/c.txt": 1 }, r =>
      r.key === "e/b.txt" && r.method === "PUT"
        ? new Response("<Error><Code>AccessDenied</Code><Message>no</Message></Error>", { status: 403 })
        : undefined);
    await expect(driver.move("/d", "/e")).rejects.toThrow(/AccessDenied/);
    expect([
      ...store.keys(),
    ].sort()).toEqual(["d/a.txt", "d/b.txt", "d/c.txt"]);
    expect(requests.some(r => r.method === "DELETE" && r.key.startsWith("d/"))).toBe(false);
  });
});

describe("s3Driver conditional writes (mocked fetch)", () => {
  afterEach(() => {
    (globalThis.fetch as unknown as { mockRestore: () => void }).mockRestore();
  });

  const enc = new TextEncoder();
  const failed = (status: number, code: string) =>
    new Response(`<Error><Code>${code}</Code><Message>no</Message></Error>`, { status });

  /** Fails the next conditional PUT / CompleteMultipartUpload with `fail`, as S3 does when a concurrent writer wins. */
  function racedS3(objects: Record<string, number>) {
    let fail: Response | undefined;
    const s3 = fakeS3(objects, (r) => {
      const conditional = r.method === "PUT"
        ? !r.query.has("partNumber")
        : r.method === "POST" && r.query.has("uploadId");
      if (!conditional || !fail)
        return undefined;
      const res = fail;
      fail = undefined;
      return res;
    });
    return {
      ...s3,
      failNext: (res: Response) => {
        fail = res;
      },
    };
  }

  it("sends If-None-Match on exclusive writes and maps 412 / 409 to EXISTS", async () => {
    const { driver, requests, failNext } = racedS3({});
    await driver.write("/a.txt", enc.encode("a"), { exclusive: true });
    expect(requests.find(r => r.method === "PUT")?.headers.get("if-none-match")).toBe("*");
    failNext(failed(412, "PreconditionFailed"));
    await expect(driver.write("/b.txt", enc.encode("b"), { exclusive: true })).rejects.toMatchObject({ code: "EXISTS" });
    failNext(failed(409, "ConditionalRequestConflict"));
    await expect(driver.write("/c.txt", enc.encode("c"), { exclusive: true })).rejects.toMatchObject({ code: "EXISTS" });
  });

  it("sends If-Match on ifMatch writes and maps 412 / 404 to ETAG_MISMATCH", async () => {
    const { driver, requests, failNext } = racedS3({ "a.txt": 1 });
    await driver.write("/a.txt", enc.encode("a"), { ifMatch: "e" });
    expect(requests.find(r => r.method === "PUT")?.headers.get("if-match")).toBe("\"e\"");
    failNext(failed(412, "PreconditionFailed"));
    await expect(driver.write("/a.txt", enc.encode("b"), { ifMatch: "e" })).rejects.toMatchObject({ code: "ETAG_MISMATCH" });
    failNext(failed(404, "NoSuchKey"));
    await expect(driver.write("/a.txt", enc.encode("b"), { ifMatch: "e" })).rejects.toMatchObject({ code: "ETAG_MISMATCH" });
  });

  it("sends the conditions on CompleteMultipartUpload and maps 412", async () => {
    const { driver, requests, failNext } = racedS3({ "old.bin": 1 });
    const mp = driver.multipart!;
    const parts = [
      { n: 1, size: 1, etag: "p1" },
    ];
    await mp.complete("/a.bin", "up1", parts, { exclusive: true });
    expect(requests.find(r => r.method === "POST" && r.key === "a.bin")?.headers.get("if-none-match")).toBe("*");
    await mp.complete("/old.bin", "up1", parts, { ifMatch: "e" });
    expect(requests.find(r => r.method === "POST" && r.key === "old.bin")?.headers.get("if-match")).toBe("\"e\"");
    failNext(failed(412, "PreconditionFailed"));
    await expect(mp.complete("/b.bin", "up1", parts, { exclusive: true })).rejects.toMatchObject({ code: "EXISTS" });
    failNext(failed(412, "PreconditionFailed"));
    await expect(mp.complete("/old.bin", "up1", parts, { ifMatch: "e" })).rejects.toMatchObject({ code: "ETAG_MISMATCH" });
  });
});

const endpoint = process.env.FM_TEST_S3_ENDPOINT;

if (!endpoint) {
  it.skip("s3 driver contract (set FM_TEST_S3_ENDPOINT to run)", () => {});
}
else {
  const base: FmS3DriverOptions = {
    endpoint,
    bucket: process.env.FM_TEST_S3_BUCKET ?? "fm-test",
    accessKeyId: process.env.FM_TEST_S3_ACCESS_KEY_ID ?? "fmtest",
    secretAccessKey: process.env.FM_TEST_S3_SECRET_ACCESS_KEY ?? "fmtest-secret",
  };

  beforeAll(async () => {
    const client = new AwsClient({
      accessKeyId: base.accessKeyId,
      secretAccessKey: base.secretAccessKey,
      service: "s3",
      region: "us-east-1",
    });
    const res = await client.fetch(`${endpoint}/${base.bucket}`, { method: "PUT" });
    if (!res.ok && res.status !== 409)
      throw new Error(`create bucket: ${res.status} ${await res.text()}`);
  });

  const fresh = (o: Partial<FmS3DriverOptions> = {}) => s3Driver({
    ...base,
    prefix: `t-${crypto.randomUUID()}/`,
    ...o,
  });

  for (const presignUploads of [false, true]) {
    runDriverContract(presignUploads
      ? "s3 (presigned uploads)"
      : "s3", async () => {
      const driver = fresh({ presignUploads });
      return {
        driver,
        cleanup: async () => {
          for (const e of await driver.list("/"))
            await driver.remove(e.path);
        },
      };
    });
  }

  describe("s3Driver specifics", () => {
    it("round-trips awkward key names", async () => {
      const driver = fresh();
      const path = "/dir é/a b+c#?&=.txt";
      await driver.write(path, new TextEncoder().encode("x"));
      expect((await driver.list("/dir é")).map(e => e.name)).toEqual(["a b+c#?&=.txt"]);
      expect(new TextDecoder().decode(await readAll((await driver.read(path)).body))).toBe("x");
      await driver.remove("/dir é");
    });

    it("caps recursive operations", async () => {
      const driver = s3Driver({ ...base, prefix: `t-${crypto.randomUUID()}/`, maxObjects: 2 });
      for (const n of ["a", "b", "c"])
        await driver.write(`/d/${n}.txt`, new TextEncoder().encode(n));
      await expect(driver.copy("/d", "/e")).rejects.toMatchObject({ code: "TOO_LARGE" });
      for (const n of ["a", "b", "c"])
        await driver.remove(`/d/${n}.txt`);
    });

    it("reports read-only caps", () => {
      const driver = s3Driver({ ...base, readOnly: true });
      expect(driver.caps.write).toBe(false);
      expect(driver.multipart).toBeUndefined();
    });

    it("streams a sized write", async () => {
      const driver = fresh();
      const data = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
      const e = await driver.write("/big.bin", new Response(data).body!, { size: data.byteLength });
      expect(e.size).toBe(data.byteLength);
      expect(await readAll((await driver.read("/big.bin")).body)).toEqual(data);
      await driver.remove("/big.bin");
    });

    it("presigns part uploads only when enabled", async () => {
      expect(fresh().multipart?.presignPart).toBeUndefined();
      const driver = fresh({ presignUploads: true });
      const mp = driver.multipart!;
      const id = await mp.begin("/p.bin");
      const url = await mp.presignPart!("/p.bin", id, 1, 60);
      expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("60");
      const res = await fetch(url, {
        method: "PUT",
        body: new TextEncoder().encode("hi"),
      });
      expect(res.status).toBe(200);
      await res.text();
      const parts = await mp.listParts("/p.bin", id);
      expect(parts).toEqual([
        {
          n: 1,
          size: 2,
          etag: (res.headers.get("etag") ?? "").replace(/"/g, ""),
        },
      ]);
      await mp.complete("/p.bin", id, parts);
      expect(new TextDecoder().decode(await readAll((await driver.read("/p.bin")).body))).toBe("hi");
      await driver.remove("/p.bin");
    });
  });
}
