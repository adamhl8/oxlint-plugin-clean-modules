import path from "node:path"

import type { Context, ESTree } from "@oxlint/plugins"
import { defineRule } from "@oxlint/plugins"

import { getOptionsObject } from "#rule-options.ts"

/** The options of `require-direct-exports`. */
interface DirectExportsOptions {
  allowEmpty: boolean
  barrels: readonly Barrel[]
}

/** An export statement the rule reports, and the declarations to export instead when the rule can fix it. */
export interface ExportProblem {
  messageId: "reexport" | "emptyExport" | "indirectExport"
  statement: ESTree.Node
  declarations?: ESTree.Node[]
}

/** The top-level names a statement declares, and whether putting `export` in front of it exports exactly those. */
interface DeclaredNames {
  names: string[]
  canExport: boolean
}

/** The statement that declares a top-level name, and whether putting `export` in front of it exports the name. */
interface Declaration {
  statement: ESTree.Node
  canExport: boolean
}

type TopLevelStatement = ESTree.Program["body"][number]

// Name the files where re-exports belong: an `index` file, and a main module, which is named after its folder.
const BARRELS = ["index", "main-module"] as const
type Barrel = (typeof BARRELS)[number]

const isBarrel = (value: unknown): value is Barrel => BARRELS.some((barrel) => barrel === value)

/** Returns the rule's options, with the defaults for the ones it wasn't given. */
export const readDirectExportsOptions = (options: Context["options"]): DirectExportsOptions => {
  const { allowEmpty, barrels } = getOptionsObject(options)
  return { allowEmpty: allowEmpty === true, barrels: Array.isArray(barrels) ? barrels.filter(isBarrel) : BARRELS }
}

/** Reports whether a file is one of the `barrels` kinds of file, where re-exports belong. */
export const isBarrelFile = (filePath: string, barrels: readonly Barrel[]): boolean => {
  const { name, dir } = path.parse(filePath)
  const isIndex = barrels.includes("index") && name === "index"
  const isMainModule = barrels.includes("main-module") && name === path.basename(dir)
  return isIndex || isMainModule
}

/** Returns the names a top-level statement declares, or `undefined` for a statement that declares none. */
const toDeclaredNames = (statement: TopLevelStatement): DeclaredNames | undefined => {
  if (statement.type === "VariableDeclaration") {
    const names = statement.declarations.flatMap(({ id }) => (id.type === "Identifier" ? [id.name] : []))
    // Leave `const a = 1, b = 2` unfixed, because `export` in front of it exports every declarator.
    return { names, canExport: statement.declarations.length === 1 }
  }
  if (statement.type === "FunctionDeclaration")
    return { names: statement.id ? [statement.id.name] : [], canExport: true }
  if (statement.type === "ClassDeclaration") {
    // Leave a decorated class unfixed, because `export` would land in front of the decorator.
    return { names: statement.id ? [statement.id.name] : [], canExport: statement.decorators.length === 0 }
  }
  if (
    statement.type === "TSInterfaceDeclaration"
    || statement.type === "TSTypeAliasDeclaration"
    || statement.type === "TSEnumDeclaration"
  )
    return { names: [statement.id.name], canExport: true }
  if (statement.type === "TSModuleDeclaration")
    return { names: statement.id.type === "Identifier" ? [statement.id.name] : [], canExport: true }
  // Leave an imported name unfixed, because only a re-export can export it.
  if (statement.type === "ImportDeclaration")
    return { names: statement.specifiers.map(({ local }) => local.name), canExport: false }
  return undefined
}

/** Returns the statement that declares each top-level name in a module. */
const mapDeclarations = (program: ESTree.Program): Map<string, Declaration> => {
  const declarations = new Map<string, Declaration>()
  for (const statement of program.body) {
    const declaredNames = toDeclaredNames(statement)
    if (declaredNames === undefined) continue

    for (const name of declaredNames.names) {
      // Leave a name declared twice unfixed, because no single statement declares it.
      const isRedeclared = declarations.has(name)
      declarations.set(name, { statement, canExport: declaredNames.canExport && !isRedeclared })
    }
  }
  return declarations
}

/** Returns a name an export statement names, or `undefined` for a string name like `"a-b"`. */
const getExportName = (exportName: ESTree.ModuleExportName): string | undefined =>
  exportName.type === "Identifier" ? exportName.name : undefined

/** Returns the statement to put `export` in front of instead of listing a name, or `undefined` when there's none. */
const findExportableDeclaration = (
  specifier: ESTree.ExportSpecifier,
  declarations: Map<string, Declaration>,
): ESTree.Node | undefined => {
  const localName = getExportName(specifier.local)
  // Leave a renamed export unfixed, because `export` on a declaration exports the declared name.
  if (localName === undefined || localName !== getExportName(specifier.exported)) return undefined

  const declaration = declarations.get(localName)
  return declaration?.canExport ? declaration.statement : undefined
}

/** Returns the problem with a top-level statement, or `undefined` when it's not an export, or a direct one. */
const checkExportStatement = (
  statement: TopLevelStatement,
  declarations: Map<string, Declaration>,
  allowEmpty: boolean,
): ExportProblem | undefined => {
  if (statement.type === "ExportAllDeclaration") return { messageId: "reexport", statement }
  if (statement.type !== "ExportNamedDeclaration" || statement.declaration !== null) return undefined
  if (statement.source !== null) return { messageId: "reexport", statement }
  if (statement.specifiers.length === 0) return allowEmpty ? undefined : { messageId: "emptyExport", statement }

  const exportableDeclarations = statement.specifiers.flatMap((specifier) => {
    const declaration = findExportableDeclaration(specifier, declarations)
    return declaration ? [declaration] : []
  })
  const canFix = exportableDeclarations.length === statement.specifiers.length
  return canFix
    ? { messageId: "indirectExport", statement, declarations: exportableDeclarations }
    : { messageId: "indirectExport", statement }
}

/** Returns every export statement in a module that doesn't export a declaration directly. */
export const findExportProblems = (program: ESTree.Program, allowEmpty: boolean): ExportProblem[] => {
  const declarations = mapDeclarations(program)
  return program.body.flatMap((statement) => checkExportStatement(statement, declarations, allowEmpty) ?? [])
}

export const requireDirectExports = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Require exports to be declared directly on the declaration." },
    fixable: "code",
    schema: [
      {
        type: "object",
        properties: {
          allowEmpty: { type: "boolean" },
          barrels: { type: "array", items: { type: "string", enum: [...BARRELS] }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      indirectExport: "Add `export` directly to the declaration instead of a separate `export { ... }` statement.",
      reexport: "Re-exports are not allowed here; export directly on the declaration in the defining module.",
      emptyExport: "Remove the empty `export {}` statement.",
    },
  },
  create: (context) => {
    const { allowEmpty, barrels } = readDirectExportsOptions(context.options)
    if (isBarrelFile(context.filename, barrels)) return {}

    return {
      Program: (program) => {
        for (const { messageId, statement, declarations } of findExportProblems(program, allowEmpty)) {
          context.report({
            node: statement,
            messageId,
            fix: (fixer) =>
              declarations && [
                ...declarations.map((declaration) => fixer.insertTextBefore(declaration, "export ")),
                fixer.remove(statement),
              ],
          })
        }
      },
    }
  },
})
