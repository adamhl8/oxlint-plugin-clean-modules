import { describe, expect, it } from "bun:test"

import type { ESTree } from "@oxlint/plugins"
import { parseSync } from "oxc-parser"

import { findExportProblems, isBarrelFile, readDirectExportsOptions } from "#require-direct-exports.ts"

/** Returns what `findExportProblems` finds in a module's code, with each statement and declaration as its text. */
const findCodeProblems = (code: string, allowEmpty = false) => {
  const { program: parsedProgram } = parseSync("module.ts", code)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - oxc-parser builds oxlint's AST, but its types leave out `loc`, `comments`, and `tokens`
  const program = parsedProgram as unknown as ESTree.Program
  const toText = (node: ESTree.Node) => code.slice(node.start, node.end)
  return findExportProblems(program, allowEmpty).map(({ messageId, statement, declarations }) =>
    declarations
      ? { messageId, statement: toText(statement), declarations: declarations.map(toText) }
      : { messageId, statement: toText(statement) },
  )
}

describe("findExportProblems", () => {
  it.each([
    { description: "a variable", code: "const a = 1\nexport { a }", declarations: ["const a = 1"] },
    { description: "a function", code: "function f() {}\nexport { f }", declarations: ["function f() {}"] },
    { description: "a class", code: "class C {}\nexport { C }", declarations: ["class C {}"] },
    {
      description: "an interface, as a type export",
      code: "interface I {}\nexport type { I }",
      declarations: ["interface I {}"],
    },
    {
      description: "several declarations",
      code: "const a = 1\nconst b = 2\nexport { a, b }",
      declarations: ["const a = 1", "const b = 2"],
    },
    {
      description: "a declaration beside a module declaration with a string name",
      code: 'declare module "foo" {}\nconst a = 1\nexport { a }',
      declarations: ["const a = 1"],
    },
  ])("should fix an indirect export of $description", ({ code, declarations }) => {
    const statement = code.slice(code.lastIndexOf("export"))

    expect(findCodeProblems(code)).toStrictEqual([
      { messageId: "indirectExport", statement, declarations: [...declarations] },
    ])
  })

  it.each([
    { description: "a renamed export", code: "const a = 1\nexport { a as b }" },
    { description: "one declarator of several", code: "const a = 1, b = 2\nexport { a }" },
    { description: "an imported name", code: 'import { z } from "./z"\nexport { z }' },
    { description: "a decorated class", code: "@dec\nclass C {}\nexport { C }" },
    { description: "a name declared twice", code: "function f() {}\nfunction f() {}\nexport { f }" },
    { description: "a destructured name", code: "const { a } = o\nexport { a }" },
  ])("should report an indirect export of $description without a fix", ({ code }) => {
    const statement = code.slice(code.lastIndexOf("export"))

    expect(findCodeProblems(code)).toStrictEqual([{ messageId: "indirectExport", statement }])
  })

  it.each([
    { description: "a named re-export", code: 'export { a } from "./b"' },
    { description: "a star re-export", code: 'export * from "./b"' },
  ])("should report $description", ({ code }) => {
    expect(findCodeProblems(code)).toStrictEqual([{ messageId: "reexport", statement: code }])
  })

  it("should report an empty export", () => {
    expect(findCodeProblems("export {}")).toStrictEqual([{ messageId: "emptyExport", statement: "export {}" }])
  })

  it("should allow an empty export when allowEmpty is on", () => {
    expect(findCodeProblems("export {}", true)).toStrictEqual([])
  })

  it.each([
    { description: "a direct export", code: "export const a = 1" },
    { description: "an exported function", code: "export function f() {}" },
    { description: "a default export", code: "export default 1" },
    { description: "a module with no exports", code: "const a = 1" },
    {
      description: "a re-export inside a module declaration",
      code: 'declare module "foo" {\n  export * from "./bar"\n}',
    },
  ])("should allow $description", ({ code }) => {
    expect(findCodeProblems(code)).toStrictEqual([])
  })
})

describe("isBarrelFile", () => {
  it.each([
    { description: "an index file", filePath: "index.ts", barrels: ["index", "main-module"] as const },
    { description: "a main module", filePath: "session/session.ts", barrels: ["index", "main-module"] as const },
    {
      description: "a main module when only main modules are",
      filePath: "session/session.ts",
      barrels: ["main-module"] as const,
    },
    { description: "an index file when only index files are", filePath: "index.ts", barrels: ["index"] as const },
  ])("should treat $description as a barrel", ({ filePath, barrels }) => {
    expect(isBarrelFile(filePath, barrels)).toBe(true)
  })

  it.each([
    { description: "a module named like neither", filePath: "file.ts", barrels: ["index", "main-module"] as const },
    {
      description: "a main module when only index files are",
      filePath: "session/session.ts",
      barrels: ["index"] as const,
    },
    {
      description: "an index file when only main modules are",
      filePath: "index.ts",
      barrels: ["main-module"] as const,
    },
    {
      description: "a module named after its folder's parent",
      filePath: "session/handlers/session.ts",
      barrels: ["index", "main-module"] as const,
    },
  ])("should not treat $description as a barrel", ({ filePath, barrels }) => {
    expect(isBarrelFile(filePath, barrels)).toBe(false)
  })
})

describe("readDirectExportsOptions", () => {
  it("should read the options", () => {
    expect(readDirectExportsOptions([{ allowEmpty: true, barrels: ["index"] }])).toStrictEqual({
      allowEmpty: true,
      barrels: ["index"],
    })
  })

  it("should treat both kinds of file as barrels, and disallow an empty export, when the rule has no options", () => {
    expect(readDirectExportsOptions([])).toStrictEqual({ allowEmpty: false, barrels: ["index", "main-module"] })
  })
})
