import { beforeAll, describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun, { $ } from "bun"

import { buildPlugin, OXLINT_BIN, PLUGIN_PATH } from "#__tests__/oxlint.ts"
import { isIndexFile, readDirectExportsOptions, requireDirectExports } from "#require-direct-exports.ts"

const RULE_NAME = "clean-modules/require-direct-exports"
const RULE_CODE = "clean-modules(require-direct-exports)"

/** A module the rule lints, the name of its file, and whether the rule allows an empty export. */
interface RuleCase {
  code: string
  filename?: string
  allowEmpty?: boolean
}

/** What the rule reports in a module, with each statement as its text, and the module after `oxlint --fix`. */
interface RuleResult {
  problems: { messageId: string; statement: string }[]
  output: string
}

interface OxlintReport {
  diagnostics: {
    code: string
    message: string
    filename: string
    labels: { span: { offset: number; length: number } }[]
  }[]
}

const MESSAGE_IDS = new Map(
  Object.entries(requireDirectExports.meta?.messages ?? {}).map(([messageId, message]) => [message, messageId]),
)

const toCaseKey = ({ code, filename = "module.ts", allowEmpty = false }: RuleCase) =>
  JSON.stringify([code, filename, allowEmpty])

/**
 * Lints each case in its own folder of one project, with oxlint and the built plugin, then fixes them all. Lint every
 * case in one run, because each oxlint run starts the plugin again.
 */
const lintCases = async (cases: RuleCase[]): Promise<Map<string, RuleResult>> => {
  const directory = await makeTempDir()
  const casePaths = cases.map(({ filename = "module.ts" }, index) => path.join(`case-${index}`, filename))
  await Promise.all(cases.map(async ({ code }, index) => bun.write(path.join(directory, casePaths[index] ?? ""), code)))

  const overrides = cases.flatMap(({ allowEmpty }, index) =>
    allowEmpty ? [{ files: [`case-${index}/**`], rules: { [RULE_NAME]: ["error", { allowEmpty: true }] } }] : [],
  )
  // Turn the default rules off, so `--fix` applies only this rule's fixes.
  const config = {
    jsPlugins: [PLUGIN_PATH],
    categories: { correctness: "off" },
    rules: { [RULE_NAME]: "error" },
    overrides,
  }
  await bun.write(path.join(directory, ".oxlintrc.json"), JSON.stringify(config))

  // Read the report whatever the exit code, because oxlint exits non-zero when it finds problems.
  // oxlint-disable-next-line typescript/no-unsafe-assignment - oxlint doesn't publish a type for its JSON report
  const report: OxlintReport = await $`${OXLINT_BIN} --format=json`.cwd(directory).nothrow().quiet().json()
  await $`${OXLINT_BIN} --fix`.cwd(directory).nothrow().quiet()

  const results = await Promise.all(
    cases.map(async (ruleCase, index): Promise<[string, RuleResult]> => {
      const casePath = casePaths[index] ?? ""
      const problems = report.diagnostics
        .filter(({ code, filename }) => code === RULE_CODE && filename === casePath)
        .flatMap(({ message, labels }) => labels.map(({ span }) => ({ message, span })))
        .toSorted((first, second) => first.span.offset - second.span.offset)
        .map(({ message, span: { offset, length } }) => ({
          messageId: MESSAGE_IDS.get(message) ?? message,
          statement: ruleCase.code.slice(offset, offset + length),
        }))
      const output = await bun.file(path.join(directory, casePath)).text()
      return [toCaseKey(ruleCase), { problems, output }]
    }),
  )
  return new Map(results)
}

/** Returns the text of the last `export` statement in `code`. */
const lastExport = (code: string) => code.slice(code.lastIndexOf("export"))

const INDIRECT_EXPORT_FIXES = [
  { description: "a variable", code: "const a = 1\nexport { a }", output: "export const a = 1\n" },
  { description: "a function", code: "function f() {}\nexport { f }", output: "export function f() {}\n" },
  { description: "a class", code: "class C {}\nexport { C }", output: "export class C {}\n" },
  {
    description: "an interface, as a type export",
    code: "interface I {}\nexport type { I }",
    output: "export interface I {}\n",
  },
  {
    description: "several declarations",
    code: "const a = 1\nconst b = 2\nexport { a, b }",
    output: "export const a = 1\nexport const b = 2\n",
  },
  {
    description: "a declaration beside a module declaration with a string name",
    code: 'declare module "foo" {}\nconst a = 1\nexport { a }',
    output: 'declare module "foo" {}\nexport const a = 1\n',
  },
]

const UNFIXED_INDIRECT_EXPORTS = [
  { description: "a renamed export", code: "const a = 1\nexport { a as b }" },
  { description: "one declarator of several", code: "const a = 1, b = 2\nexport { a }" },
  { description: "an imported name", code: 'import { z } from "./z"\nexport { z }' },
  { description: "a decorated class", code: "@dec\nclass C {}\nexport { C }" },
  { description: "a name declared twice", code: "function f() {}\nfunction f() {}\nexport { f }" },
  { description: "a destructured name", code: "const { a } = o\nexport { a }" },
]

const REEXPORTS = [
  { description: "a named re-export", code: 'export { a } from "./b"' },
  { description: "a star re-export", code: 'export * from "./b"' },
]

const ALLOWED_EXPORTS = [
  { description: "a direct export", code: "export const a = 1" },
  { description: "an exported function", code: "export function f() {}" },
  { description: "a default export", code: "export default 1" },
  { description: "a module with no exports", code: "const a = 1" },
  {
    description: "a re-export inside a module declaration",
    code: 'declare module "foo" {\n  export * from "./bar"\n}',
  },
]

const INDEX_REEXPORT_FIXES = [
  { description: "a named import", code: 'import { a } from "./a"\nexport { a }', output: 'export { a } from "./a"' },
  {
    description: "a name exported under another name",
    code: 'import { a } from "./a"\nexport { a as b }',
    output: 'export { a as b } from "./a"',
  },
  {
    description: "a name imported under another name",
    code: 'import { a as b } from "./a"\nexport { b }',
    output: 'export { a as b } from "./a"',
  },
  {
    description: "a string name",
    code: 'import { "a-b" as a } from "./a"\nexport { a }',
    output: 'export { "a-b" as a } from "./a"',
  },
  {
    description: "a default import",
    code: 'import a from "./a"\nexport { a }',
    output: 'export { default as a } from "./a"',
  },
  {
    description: "a namespace import",
    code: 'import * as a from "./a"\nexport { a }',
    output: 'export * as a from "./a"',
  },
  {
    description: "a type import",
    code: 'import type { A } from "./a"\nexport { A }',
    output: 'export type { A } from "./a"',
  },
  {
    description: "a type export",
    code: 'import { A } from "./a"\nexport type { A }',
    output: 'export type { A } from "./a"',
  },
  {
    description: "a type and a value from one import",
    code: 'import { type A, b } from "./a"\nexport { A, b }',
    output: 'export { type A, b } from "./a"',
  },
  {
    description: "names from two imports",
    code: 'import { a } from "./a"\nimport { b } from "./b"\nexport { a, b }',
    output: 'export { a } from "./a"\nexport { b } from "./b"',
  },
  {
    description: "an import the module also uses",
    code: 'import { a } from "./a"\nconsole.log(a)\nexport { a }',
    output: 'import { a } from "./a"\nconsole.log(a)\nexport { a } from "./a"',
  },
  {
    description: "an import the module also uses as a type",
    code: 'import { A } from "./a"\nconst x: A = 1\nexport { A }',
    output: 'import { A } from "./a"\nconst x: A = 1\nexport { A } from "./a"',
  },
  {
    description: "one name of an import whose other name the module uses",
    code: 'import { a, b } from "./a"\nconsole.log(b)\nexport { a }',
    output: 'import { b } from "./a"\nconsole.log(b)\nexport { a } from "./a"',
  },
  {
    description: "a name that's also a comment, a string, a property, and a parameter",
    code: 'import { a } from "./a"\n// a\nconst s = "a"\no.a\nfunction g(a) { return a }\nexport { a }',
    output: '// a\nconst s = "a"\no.a\nfunction g(a) { return a }\nexport { a } from "./a"',
  },
  {
    description: "statements with single quotes and semicolons",
    code: "import { a } from './a';\nexport { a };",
    output: "export { a } from './a';",
  },
]

const INDEX_ALLOWED_EXPORTS = [
  { description: "a named re-export", code: 'export { a } from "./b"' },
  { description: "a star re-export", code: 'export * from "./b"' },
  { description: "a direct export", code: "export const a = 1" },
]

const EMPTY_EXPORT_WITH_IMPORT = 'import "./a"\nexport {}'
const IMPORT_WITH_ATTRIBUTES = 'import a from "./a.json" with { type: "json" }\nexport { a }'
const IMPORTED_AND_DECLARED_EXPORT = 'import { a } from "./a"\nconst b = 1\nexport { a, b }'

const RULE_CASES: RuleCase[] = [
  ...[...INDIRECT_EXPORT_FIXES, ...UNFIXED_INDIRECT_EXPORTS, ...REEXPORTS, ...ALLOWED_EXPORTS].map(({ code }) => ({
    code,
  })),
  { code: EMPTY_EXPORT_WITH_IMPORT },
  { code: "export {}" },
  { code: "export {}", allowEmpty: true },
  ...[...INDEX_REEXPORT_FIXES, ...INDEX_ALLOWED_EXPORTS].map(({ code }) => ({ code, filename: "index.ts" })),
  { code: "const a = 1\nexport { a }", filename: "index.ts" },
  { code: "export {}", filename: "index.ts" },
  { code: IMPORT_WITH_ATTRIBUTES, filename: "index.ts" },
  { code: IMPORTED_AND_DECLARED_EXPORT, filename: "index.ts" },
]

let results = new Map<string, RuleResult>()

beforeAll(async () => {
  await buildPlugin()
  results = await lintCases(RULE_CASES)
})

const lint = (ruleCase: RuleCase) => results.get(toCaseKey(ruleCase))

describe("require-direct-exports", () => {
  it.each(INDIRECT_EXPORT_FIXES)("should fix an indirect export of $description", ({ code, output }) => {
    expect(lint({ code })).toStrictEqual({
      problems: [{ messageId: "indirectExport", statement: lastExport(code) }],
      output,
    })
  })

  it.each(UNFIXED_INDIRECT_EXPORTS)("should report an indirect export of $description without a fix", ({ code }) => {
    expect(lint({ code })).toStrictEqual({
      problems: [{ messageId: "indirectExport", statement: lastExport(code) }],
      output: code,
    })
  })

  it.each(REEXPORTS)("should report $description", ({ code }) => {
    expect(lint({ code })).toStrictEqual({ problems: [{ messageId: "reexport", statement: code }], output: code })
  })

  it("should fix an empty export in a module that imports something", () => {
    expect(lint({ code: EMPTY_EXPORT_WITH_IMPORT })).toStrictEqual({
      problems: [{ messageId: "emptyExport", statement: "export {}" }],
      output: 'import "./a"\n',
    })
  })

  it("should report an empty export that's the module's only export without a fix", () => {
    expect(lint({ code: "export {}" })).toStrictEqual({
      problems: [{ messageId: "emptyExport", statement: "export {}" }],
      output: "export {}",
    })
  })

  it("should allow an empty export when allowEmpty is on", () => {
    expect(lint({ code: "export {}", allowEmpty: true })).toStrictEqual({ problems: [], output: "export {}" })
  })

  it.each(ALLOWED_EXPORTS)("should allow $description", ({ code }) => {
    expect(lint({ code })).toStrictEqual({ problems: [], output: code })
  })
})

describe("require-direct-exports in an index file", () => {
  it.each(INDEX_ALLOWED_EXPORTS)("should allow $description", ({ code }) => {
    expect(lint({ code, filename: "index.ts" })).toStrictEqual({ problems: [], output: code })
  })

  it("should fix an indirect export of a declaration", () => {
    expect(lint({ code: "const a = 1\nexport { a }", filename: "index.ts" })).toStrictEqual({
      problems: [{ messageId: "indirectExport", statement: "export { a }" }],
      output: "export const a = 1\n",
    })
  })

  it("should report an empty export", () => {
    expect(lint({ code: "export {}", filename: "index.ts" })).toStrictEqual({
      problems: [{ messageId: "emptyExport", statement: "export {}" }],
      output: "export {}",
    })
  })

  it.each(INDEX_REEXPORT_FIXES)("should fix an export of $description as a re-export", ({ code, output }) => {
    expect(lint({ code, filename: "index.ts" })).toStrictEqual({
      problems: [{ messageId: "importedExport", statement: lastExport(code) }],
      output,
    })
  })

  it("should report an export of a name imported with attributes without a fix", () => {
    expect(lint({ code: IMPORT_WITH_ATTRIBUTES, filename: "index.ts" })).toStrictEqual({
      problems: [{ messageId: "importedExport", statement: "export { a }" }],
      output: IMPORT_WITH_ATTRIBUTES,
    })
  })

  it("should report an export of an imported name beside a declared one as an indirect export without a fix", () => {
    expect(lint({ code: IMPORTED_AND_DECLARED_EXPORT, filename: "index.ts" })).toStrictEqual({
      problems: [{ messageId: "indirectExport", statement: "export { a, b }" }],
      output: IMPORTED_AND_DECLARED_EXPORT,
    })
  })
})

describe("isIndexFile", () => {
  it.each(["index.ts", "src/feature/index.tsx"])("should treat %s as an index file", (filePath) => {
    expect(isIndexFile(filePath)).toBe(true)
  })

  it.each(["file.ts", "session/session.ts", "index/file.ts"])("should not treat %s as an index file", (filePath) => {
    expect(isIndexFile(filePath)).toBe(false)
  })
})

describe("readDirectExportsOptions", () => {
  it("should read the options", () => {
    expect(readDirectExportsOptions([{ allowEmpty: true }])).toStrictEqual({ allowEmpty: true })
  })

  it("should disallow an empty export when the rule has no options", () => {
    expect(readDirectExportsOptions([])).toStrictEqual({ allowEmpty: false })
  })
})
