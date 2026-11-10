import { describe, expect, it } from "bun:test"
import path from "node:path"

import { IMPORTER_PATH, NO_IMPORTS_IMPORTER_PATH, PROJECT_DIRECTORY } from "#__tests__/project.ts"
import { checkImportExtension } from "#require-import-extensions.ts"

describe("checkImportExtension", () => {
  it.each([
    { description: "a missing extension", specifier: "./bar", expected: ".ts", replacement: "./bar.ts" },
    {
      description: "a `.js` extension on a `.ts` module",
      specifier: "./bar.js",
      expected: ".ts",
      replacement: "./bar.ts",
    },
    { description: "a missing `.tsx` extension", specifier: "./widget", expected: ".tsx", replacement: "./widget.tsx" },
    {
      description: "a missing `.d.ts` extension",
      specifier: "./decls",
      expected: ".d.ts",
      replacement: "./decls.d.ts",
    },
    {
      description: "a subpath import's missing extension",
      specifier: "#utils/helper",
      expected: ".ts",
      replacement: "#utils/helper.ts",
    },
  ])("should replace $description with the extension on disk", ({ specifier, expected, replacement }) => {
    expect(checkImportExtension(IMPORTER_PATH, specifier)).toStrictEqual({
      messageId: "wrongExtension",
      data: { specifier, expected },
      replacement,
    })
  })

  it.each([
    { description: "a relative import", specifier: "./dir-import", replacement: "./dir-import/index.ts" },
    { description: "a subpath import", specifier: "#dir-import", replacement: "#dir-import/index.ts" },
    { description: "a trailing slash", specifier: "./dir-import/", replacement: "./dir-import/index.ts" },
  ])("should point a directory import with $description at its index file", ({ specifier, replacement }) => {
    expect(checkImportExtension(IMPORTER_PATH, specifier)).toStrictEqual({
      messageId: "directoryIndex",
      data: { specifier, index: replacement },
      replacement,
    })
  })

  it("should report a module that isn't on disk without a fix", () => {
    const lookup = `${path.join(PROJECT_DIRECTORY, "src", "missing")}.{ts,tsx,d.ts}`

    expect(checkImportExtension(IMPORTER_PATH, "./missing")).toStrictEqual({
      messageId: "targetNotFound",
      data: { specifier: "./missing", lookup },
    })
  })

  it.each([
    { description: "the extension on disk", importerPath: IMPORTER_PATH, specifier: "./bar.ts" },
    { description: "a `.d.ts` extension", importerPath: IMPORTER_PATH, specifier: "./decls.d.ts" },
    {
      description: "an extension TypeScript doesn't substitute",
      importerPath: IMPORTER_PATH,
      specifier: "./data.json",
    },
    {
      description: "a subpath import with the extension on disk",
      importerPath: IMPORTER_PATH,
      specifier: "#utils/helper.ts",
    },
    { description: "an index file named directly", importerPath: IMPORTER_PATH, specifier: "./dir-import/index.ts" },
    { description: "a directory without an index file", importerPath: IMPORTER_PATH, specifier: "./utils" },
    { description: "a Node built-in", importerPath: IMPORTER_PATH, specifier: "node:fs" },
    {
      description: "a subpath import no imports field covers",
      importerPath: NO_IMPORTS_IMPORTER_PATH,
      specifier: "#foo",
    },
  ])("should allow $description", ({ importerPath, specifier }) => {
    expect(checkImportExtension(importerPath, specifier)).toBeUndefined()
  })
})
