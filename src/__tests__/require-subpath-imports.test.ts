import { describe, expect, it } from "bun:test"

import { IMPORTER_PATH, NO_IMPORTS_IMPORTER_PATH } from "#__tests__/project.ts"
import { checkSubpathImport, readIgnoreOption } from "#require-subpath-imports.ts"

describe("checkSubpathImport", () => {
  it.each([
    { description: "a sibling module", specifier: "./bar", subpath: "#bar" },
    {
      description: "a module in a folder with its own imports entry",
      specifier: "./utils/helper",
      subpath: "#utils/helper",
    },
    { description: "the current directory", specifier: ".", subpath: "#index.ts" },
    { description: "the current directory with a trailing slash", specifier: "./", subpath: "#index.ts" },
    { description: "a directory with an index file", specifier: "./dir-import", subpath: "#dir-import/index.ts" },
  ])("should replace an import of $description with its subpath import", ({ specifier, subpath }) => {
    expect(checkSubpathImport(IMPORTER_PATH, specifier, [])).toStrictEqual({
      messageId: "relativeImport",
      data: { specifier, subpath },
      replacement: subpath,
    })
  })

  it.each([
    {
      description: "the parent directory, which no imports entry covers",
      importerPath: IMPORTER_PATH,
      specifier: "..",
    },
    { description: "a module outside the project", importerPath: IMPORTER_PATH, specifier: "../../outside" },
    {
      description: "a module in a project with no imports field",
      importerPath: NO_IMPORTS_IMPORTER_PATH,
      specifier: "./bar",
    },
  ])("should report an import of $description without a fix", ({ importerPath, specifier }) => {
    expect(checkSubpathImport(importerPath, specifier, [])).toStrictEqual({
      messageId: "noSubpathMatch",
      data: { specifier },
    })
  })

  it.each([
    { description: "a subpath import", specifier: "#bar", ignore: [] },
    { description: "a Node built-in", specifier: "node:fs", ignore: [] },
    { description: "a package", specifier: "some-pkg", ignore: [] },
    { description: "a relative import that contains an ignore entry", specifier: "./bar", ignore: ["bar"] },
    { description: "the current directory when it's ignored", specifier: ".", ignore: ["."] },
  ])("should allow $description", ({ specifier, ignore }) => {
    expect(checkSubpathImport(IMPORTER_PATH, specifier, ignore)).toBeUndefined()
  })
})

describe("readIgnoreOption", () => {
  it("should read the ignore entries", () => {
    expect(readIgnoreOption([{ ignore: ["@generated", "vendor"] }])).toStrictEqual(["@generated", "vendor"])
  })

  it("should ignore nothing when the rule has no options", () => {
    expect(readIgnoreOption([])).toStrictEqual([])
  })
})
