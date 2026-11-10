import { describe, expect, it } from "bun:test"
import path from "node:path"

import { isExistingDirectory } from "#imports/imports.ts"

const FIXTURES = path.join(import.meta.dir, "fixtures")

describe("isExistingDirectory", () => {
  it("returns true for a directory", () => {
    expect(isExistingDirectory(path.join(FIXTURES, "rich"))).toBe(true)
  })

  it("returns false for a missing path", () => {
    expect(isExistingDirectory(path.join(FIXTURES, "missing"))).toBe(false)
  })

  it("returns false for a path that runs through a file", () => {
    expect(isExistingDirectory(path.join(FIXTURES, "rich/package.json/child"))).toBe(false)
  })
})
