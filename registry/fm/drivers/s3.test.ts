import type { FmS3DriverOptions } from "./s3";
import { beforeAll, describe, expect, it } from "bun:test";
import { AwsClient } from "aws4fetch";
import { runDriverContract } from "../server/contract";
import { readAll } from "../server/driver";
import { parseList, s3Driver } from "./s3";

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

  const fresh = () => s3Driver({ ...base, prefix: `t-${crypto.randomUUID()}/` });

  runDriverContract("s3", async () => {
    const driver = fresh();
    return {
      driver,
      cleanup: async () => {
        for (const e of await driver.list("/"))
          await driver.remove(e.path);
      },
    };
  });

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
      expect(s3Driver({ ...base, readOnly: true }).caps.write).toBe(false);
    });
  });
}
