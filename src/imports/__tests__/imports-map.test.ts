import { describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"

import type { ImportsMap } from "#imports/imports-map.ts"
import { absToSubpath, loadImportsMap, subpathToAbs } from "#imports/imports-map.ts"

const FIXTURES = path.join(import.meta.dir, "fixtures")
const richDir = path.join(FIXTURES, "rich")
const tiebreakDir = path.join(FIXTURES, "tiebreak")
const orderDir = path.join(FIXTURES, "order")

const load = (file: string): ImportsMap => {
  const map = loadImportsMap(file)
  if (!map) throw new Error(`expected fixture ${file} to produce an imports map`)
  return map
}

const richMap = load(path.join(richDir, "src/foo.ts"))
const tiebreakMap = load(path.join(tiebreakDir, "src/foo.ts"))
const orderMap = load(path.join(orderDir, "src/foo.ts"))

describe("loadImportsMap parsing", () => {
  it("keeps only the valid entries, skipping every malformed shape", () => {
    // #*, #exact, #cond/*, #cond2/*, #alt/*, #alt2/*, #arr/* are valid; the rest are skipped.
    expect(richMap.entries).toHaveLength(7)
  })

  it("returns undefined when package.json has no imports field", () => {
    expect(loadImportsMap(path.join(FIXTURES, "no-imports/foo.ts"))).toBeUndefined()
  })

  it("returns undefined when every entry is invalid", () => {
    expect(loadImportsMap(path.join(FIXTURES, "only-invalid/foo.ts"))).toBeUndefined()
  })

  it("returns undefined when package.json is malformed", () => {
    expect(loadImportsMap(path.join(FIXTURES, "malformed/foo.ts"))).toBeUndefined()
  })

  it("returns undefined when no package.json exists above the file", () => {
    const orphan = path.join(os.tmpdir(), "clean-modules-no-pkg-here", "deep/file.ts")
    expect(loadImportsMap(orphan)).toBeUndefined()
  })
})

describe("loadImportsMap caching", () => {
  it("returns the same object for a repeated directory", () => {
    const file = path.join(richDir, "src/foo.ts")
    expect(loadImportsMap(file)).toBe(loadImportsMap(file))
  })

  it("reuses the parsed package.json across sibling directories", () => {
    const a = loadImportsMap(path.join(richDir, "a/x.ts"))
    const b = loadImportsMap(path.join(richDir, "b/y.ts"))
    expect(a).toBe(b)
  })
})

describe("absToSubpath / subpathToAbs", () => {
  it("round-trips a star entry with a plain string target", () => {
    const abs = path.join(richDir, "src/foo.ts")
    expect(absToSubpath(abs, richMap)).toBe("#foo.ts")
    expect(subpathToAbs("#foo.ts", richMap)).toBe(abs)
  })

  it("prefers an exact (non-star) entry over the star catch-all", () => {
    const abs = path.join(richDir, "src/exact.ts")
    expect(absToSubpath(abs, richMap)).toBe("#exact")
    expect(subpathToAbs("#exact", richMap)).toBe(abs)
  })

  it("resolves a conditions object by import priority", () => {
    expect(subpathToAbs("#cond/x", richMap)).toBe(path.join(richDir, "lib/cond/x"))
  })

  it("skips a non-relative condition and falls through to a later one", () => {
    expect(subpathToAbs("#cond2/x", richMap)).toBe(path.join(richDir, "lib/cond2/x"))
  })

  it("resolves a conditions object via the values fallback", () => {
    expect(subpathToAbs("#alt/x", richMap)).toBe(path.join(richDir, "lib/alt/x"))
    expect(subpathToAbs("#alt2/x", richMap)).toBe(path.join(richDir, "lib/alt2/x"))
  })

  it("resolves an array target, skipping non-relative members", () => {
    expect(subpathToAbs("#arr/x", richMap)).toBe(path.join(richDir, "lib/arr/x"))
  })

  it("returns undefined for an unmatched path or specifier", () => {
    const outside = path.join(os.tmpdir(), "elsewhere/x.ts")
    expect(absToSubpath(outside, richMap)).toBeUndefined()
    expect(subpathToAbs("#has no entry", tiebreakMap)).toBeUndefined()
  })

  it("breaks ties on the longest matching suffix", () => {
    // Both `#a/*` and `#a/*.ts` produce the same specifier; the longer-suffix entry wins the tiebreak.
    const abs = path.join(tiebreakDir, "src/foo.ts")
    expect(absToSubpath(abs, tiebreakMap)).toBe("#a/foo.ts")
    expect(subpathToAbs("#a/foo.ts", tiebreakMap)).toBe(abs)
  })

  it("keeps the more specific match when a broader entry also matches", () => {
    // `#a/b/*` is listed first, so the later, less specific `#a/*` match must not replace it.
    const abs = path.join(orderDir, "src/x/y/z")
    expect(absToSubpath(abs, orderMap)).toBe("#a/b/z")
    expect(subpathToAbs("#a/b/z", orderMap)).toBe(abs)
  })
})
