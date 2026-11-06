import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { ContextMenuSeparator } from "@/components/ui/context-menu";
import { tidyMenu } from "./tidy-menu";

const item = (key: string) => createElement("span", { key }, key);
const sep = (key: string) => createElement(ContextMenuSeparator, { key });
function keys(items: ReturnType<typeof tidyMenu>) {
  return items.map(i => (i.type === ContextMenuSeparator
    ? "|"
    : String(i.key)));
}

describe("tidyMenu", () => {
  it("drops a trailing separator left by a hidden last item (read-only delete)", () => {
    expect(keys(tidyMenu([
      item("open"),
      sep("s1"),
      item("details"),
      sep("s4"),
      null,
    ]))).toEqual(["open", "|", "details"]);
  });

  it("drops leading and repeated separators", () => {
    expect(keys(tidyMenu([
      null,
      sep("s1"),
      item("copy"),
      sep("s2"),
      false,
      sep("s3"),
      item("rename"),
    ]))).toEqual(["copy", "|", "rename"]);
  });

  it("flattens nested groups", () => {
    expect(keys(tidyMenu([
      item("open"),
      [
        item("new"),
        item("upload"),
      ],
      [],
      sep("s1"),
      item("copy"),
    ]))).toEqual(["open", "new", "upload", "|", "copy"]);
  });
});
