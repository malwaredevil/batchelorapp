import { describe, it, expect } from "vitest";
import {
  parseCell,
  isFabricCell,
  fabricIdFromCell,
} from "./cell-parser";

// ---------------------------------------------------------------------------
// Triangle cells (nwse / nesw)
// ---------------------------------------------------------------------------

describe("parseCell — triangle", () => {
  it("parses two fabric tokens correctly (the main black-block fix)", () => {
    expect(parseCell("nesw:fab:19:fab:10")).toEqual({
      kind: "triangle",
      type: "nesw",
      a: "fab:19",
      b: "fab:10",
    });
    expect(parseCell("nwse:fab:10:fab:19")).toEqual({
      kind: "triangle",
      type: "nwse",
      a: "fab:10",
      b: "fab:19",
    });
  });

  it("parses two hex tokens (backward compat)", () => {
    expect(parseCell("nwse:#FF0000:#00FF00")).toEqual({
      kind: "triangle",
      type: "nwse",
      a: "#FF0000",
      b: "#00FF00",
    });
  });

  it("parses mixed hex + fabric", () => {
    expect(parseCell("nesw:#A0A0A0:fab:10")).toEqual({
      kind: "triangle",
      type: "nesw",
      a: "#A0A0A0",
      b: "fab:10",
    });
    expect(parseCell("nwse:fab:5:#FFFFFF")).toEqual({
      kind: "triangle",
      type: "nwse",
      a: "fab:5",
      b: "#FFFFFF",
    });
  });

  it("falls back to solid when only one token is present", () => {
    const r = parseCell("nesw:only");
    expect(r.kind).toBe("solid");
  });

  it("correctly handles large fabric ids", () => {
    expect(parseCell("nesw:fab:1234:fab:5678")).toEqual({
      kind: "triangle",
      type: "nesw",
      a: "fab:1234",
      b: "fab:5678",
    });
  });
});

// ---------------------------------------------------------------------------
// Quad cells
// ---------------------------------------------------------------------------

describe("parseCell — quad", () => {
  it("parses four fabric tokens", () => {
    expect(parseCell("quad:fab:1:fab:2:fab:3:fab:4")).toEqual({
      kind: "quad",
      top: "fab:1",
      right: "fab:2",
      bottom: "fab:3",
      left: "fab:4",
    });
  });

  it("parses four hex tokens (backward compat)", () => {
    expect(parseCell("quad:#FF0000:#00FF00:#0000FF:#FFFFFF")).toEqual({
      kind: "quad",
      top: "#FF0000",
      right: "#00FF00",
      bottom: "#0000FF",
      left: "#FFFFFF",
    });
  });

  it("parses mixed hex + fabric tokens", () => {
    expect(parseCell("quad:#FF0000:fab:3:#0000FF:fab:7")).toEqual({
      kind: "quad",
      top: "#FF0000",
      right: "fab:3",
      bottom: "#0000FF",
      left: "fab:7",
    });
  });

  it("falls back to solid when token count is not 4", () => {
    expect(parseCell("quad:#FF0000:#00FF00")).toEqual({
      kind: "solid",
      color: "",
    });
  });
});

// ---------------------------------------------------------------------------
// hsplit / vsplit cells
// ---------------------------------------------------------------------------

describe("parseCell — hsplit", () => {
  it("parses fabric + fabric", () => {
    expect(parseCell("hsplit:fab:5:fab:12")).toEqual({
      kind: "hsplit",
      top: "fab:5",
      bottom: "fab:12",
    });
  });

  it("parses hex + hex (backward compat)", () => {
    expect(parseCell("hsplit:#AABBCC:#DDEEFF")).toEqual({
      kind: "hsplit",
      top: "#AABBCC",
      bottom: "#DDEEFF",
    });
  });

  it("falls back to solid with wrong count", () => {
    expect(parseCell("hsplit:#FF0000")).toEqual({ kind: "solid", color: "" });
  });
});

describe("parseCell — vsplit", () => {
  it("parses fabric + fabric", () => {
    expect(parseCell("vsplit:fab:3:fab:8")).toEqual({
      kind: "vsplit",
      left: "fab:3",
      right: "fab:8",
    });
  });

  it("parses hex + hex (backward compat)", () => {
    expect(parseCell("vsplit:#AABBCC:#DDEEFF")).toEqual({
      kind: "vsplit",
      left: "#AABBCC",
      right: "#DDEEFF",
    });
  });
});

// ---------------------------------------------------------------------------
// xsplit cells
// ---------------------------------------------------------------------------

describe("parseCell — xsplit", () => {
  it("parses four fabric tokens", () => {
    expect(parseCell("xsplit:fab:1:fab:2:fab:3:fab:4")).toEqual({
      kind: "xsplit",
      tl: "fab:1",
      tr: "fab:2",
      bl: "fab:3",
      br: "fab:4",
    });
  });

  it("parses four hex tokens (backward compat)", () => {
    expect(parseCell("xsplit:#FF0000:#00FF00:#0000FF:#FFFFFF")).toEqual({
      kind: "xsplit",
      tl: "#FF0000",
      tr: "#00FF00",
      bl: "#0000FF",
      br: "#FFFFFF",
    });
  });
});

// ---------------------------------------------------------------------------
// Solid / empty / seam-line cells
// ---------------------------------------------------------------------------

describe("parseCell — solid and empty", () => {
  it("treats empty string as solid with empty color", () => {
    expect(parseCell("")).toEqual({ kind: "solid", color: "" });
  });

  it("treats a plain hex as solid", () => {
    expect(parseCell("#FF0000")).toEqual({ kind: "solid", color: "#FF0000" });
  });

  it("treats fab:N as solid (the whole string is the color)", () => {
    const r = parseCell("fab:42");
    expect(r).toEqual({ kind: "solid", color: "fab:42" });
  });
});

describe("parseCell — seam lines", () => {
  it("recognises nwse-line shorthand", () => {
    expect(parseCell("nwse-line")).toEqual({
      kind: "line",
      type: "nwse",
      cs: 0,
      ce: 1,
    });
  });

  it("recognises nesw-line shorthand", () => {
    expect(parseCell("nesw-line")).toEqual({
      kind: "line",
      type: "nesw",
      cs: 0,
      ce: 1,
    });
  });

  it("recognises xline shorthand", () => {
    expect(parseCell("xline")).toEqual({
      kind: "xline",
      nwseCs: 0,
      nwseCe: 1,
      neswCs: 0,
      neswCe: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// isFabricCell / fabricIdFromCell
// ---------------------------------------------------------------------------

describe("isFabricCell", () => {
  it("returns true for fab: strings", () => {
    expect(isFabricCell("fab:42")).toBe(true);
    expect(isFabricCell("fab:0")).toBe(true);
  });

  it("returns false for non-fabric strings", () => {
    expect(isFabricCell("#FF0000")).toBe(false);
    expect(isFabricCell("")).toBe(false);
    expect(isFabricCell("fab")).toBe(false);
  });
});

describe("fabricIdFromCell", () => {
  it("extracts id from a fabric cell", () => {
    expect(fabricIdFromCell("fab:42")).toBe(42);
    expect(fabricIdFromCell("fab:1")).toBe(1);
  });

  it("returns null for non-fabric input", () => {
    expect(fabricIdFromCell("#FF0000")).toBeNull();
    expect(fabricIdFromCell("")).toBeNull();
    expect(fabricIdFromCell("fab:")).toBeNull();
    expect(fabricIdFromCell("fab:abc")).toBeNull();
  });
});
