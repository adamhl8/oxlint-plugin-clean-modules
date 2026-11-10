import { describe, expect, it } from "bun:test"

import plugin from "#index.ts"

describe("plugin", () => {
  it("exposes the three rules under the clean-modules name", () => {
    expect(plugin.meta?.name).toBe("clean-modules")
    expect(Object.keys(plugin.rules)).toStrictEqual([
      "require-subpath-imports",
      "require-direct-exports",
      "require-import-extensions",
    ])
  })
})
