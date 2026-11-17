import path from "node:path"

import type { Context, ESTree } from "@oxlint/plugins"
import { defineRule } from "@oxlint/plugins"

import type { FindReferences } from "#imported-exports.ts"
import { buildReexportEdits, findImportedExports, mapImportBindings } from "#imported-exports.ts"
import { getOptionsObject } from "#rule-options.ts"
import type { TextEdit } from "#text-edits.ts"
import { removeStatement } from "#text-edits.ts"

/** The options of `require-direct-exports`. */
interface DirectExportsOptions {
  allowEmpty: boolean
}

/** What `findExportProblems` checks a module with, besides its program. */
interface ExportCheckOptions extends DirectExportsOptions {
  sourceText: string
  isIndexFile: boolean
  findReferences: FindReferences
}

/** An export statement the rule reports, and the edits that fix it when the rule can. */
interface ExportProblem {
  messageId: "reexport" | "emptyExport" | "indirectExport" | "importedExport"
  statement: ESTree.Node
  edits?: TextEdit[]
}

/** What `checkExportStatement` knows about the module a statement is in. */
interface ModuleFacts extends ExportCheckOptions {
  program: ESTree.Program
  declarations: Map<string, Declaration>
  importBindings: ReturnType<typeof mapImportBindings>
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

/** Returns the rule's options, with the defaults for the ones it wasn't given. */
export const readDirectExportsOptions = (options: Context["options"]): DirectExportsOptions => {
  const { allowEmpty } = getOptionsObject(options)
  return { allowEmpty: allowEmpty === true }
}

/** Reports whether a file is an `index` file, an entry point where re-exports belong. */
export const isIndexFile = (filePath: string): boolean => path.parse(filePath).name === "index"

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

/** Reports whether a module has an import or export besides `statement`, so it stays a module without it. */
const hasOtherModuleSyntax = (program: ESTree.Program, statement: ESTree.Node): boolean =>
  program.body.some(
    (other) =>
      other !== statement
      && (other.type === "ImportDeclaration"
        || other.type === "ExportNamedDeclaration"
        || other.type === "ExportDefaultDeclaration"
        || other.type === "ExportAllDeclaration"
        || other.type === "TSExportAssignment"),
  )

/** Returns the problem with an `export { ... }` statement that lists local names. */
const checkLocalExport = (statement: ESTree.ExportNamedDeclaration, module: ModuleFacts): ExportProblem => {
  if (module.isIndexFile) {
    const importedExports = findImportedExports(statement, module.importBindings)
    if (importedExports !== undefined) {
      const context = { sourceText: module.sourceText, statement, findReferences: module.findReferences }
      const edits = buildReexportEdits(context, importedExports)
      return edits ? { messageId: "importedExport", statement, edits } : { messageId: "importedExport", statement }
    }
  }

  const exportableDeclarations = statement.specifiers.flatMap((specifier) => {
    const declaration = findExportableDeclaration(specifier, module.declarations)
    return declaration ? [declaration] : []
  })
  if (exportableDeclarations.length !== statement.specifiers.length) return { messageId: "indirectExport", statement }

  const edits = [
    ...exportableDeclarations.map((declaration): TextEdit => ({
      range: [declaration.start, declaration.start],
      text: "export ",
    })),
    removeStatement(module.sourceText, statement),
  ]
  return { messageId: "indirectExport", statement, edits }
}

/** Returns the problem with a top-level statement, or `undefined` when it's not an export, or a direct one. */
const checkExportStatement = (statement: TopLevelStatement, module: ModuleFacts): ExportProblem | undefined => {
  // Allow a re-export in an index file, because it's an entry point, where re-exports belong.
  if (statement.type === "ExportAllDeclaration")
    return module.isIndexFile ? undefined : { messageId: "reexport", statement }
  if (statement.type !== "ExportNamedDeclaration" || statement.declaration !== null) return undefined
  if (statement.source !== null) return module.isIndexFile ? undefined : { messageId: "reexport", statement }
  if (statement.specifiers.length > 0) return checkLocalExport(statement, module)
  if (module.allowEmpty) return undefined

  // Report an `export {}` that's the module's only import or export without a fix.
  // Removing it would turn the module into a script.
  return hasOtherModuleSyntax(module.program, statement)
    ? { messageId: "emptyExport", statement, edits: [removeStatement(module.sourceText, statement)] }
    : { messageId: "emptyExport", statement }
}

/** Returns every export statement in a module that doesn't export a declaration directly. */
const findExportProblems = (program: ESTree.Program, options: ExportCheckOptions): ExportProblem[] => {
  const module: ModuleFacts = {
    ...options,
    program,
    declarations: mapDeclarations(program),
    importBindings: mapImportBindings(program),
  }
  return program.body.flatMap((statement) => checkExportStatement(statement, module) ?? [])
}

export const requireDirectExports = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Require exports to be declared directly on the declaration." },
    fixable: "code",
    schema: [
      {
        type: "object",
        properties: { allowEmpty: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      indirectExport: "Add `export` directly to the declaration instead of a separate `export { ... }` statement.",
      reexport: "Re-exports are not allowed here; export directly on the declaration in the defining module.",
      emptyExport: "Remove the empty `export {}` statement.",
      importedExport:
        "Re-export imported names with `export { ... } from` instead of importing them and exporting them separately.",
    },
  },
  create: (context) => {
    const { allowEmpty } = readDirectExportsOptions(context.options)
    const options: ExportCheckOptions = {
      allowEmpty,
      sourceText: context.sourceCode.text,
      isIndexFile: isIndexFile(context.filename),
      findReferences: (specifier) =>
        context.sourceCode
          .getDeclaredVariables(specifier)
          .flatMap(({ references }) => references.map(({ identifier }) => identifier)),
    }

    return {
      Program: (program) => {
        for (const { messageId, statement, edits } of findExportProblems(program, options)) {
          context.report({
            node: statement,
            messageId,
            fix: (fixer) => edits?.map(({ range, text }) => fixer.replaceTextRange(range, text)),
          })
        }
      },
    }
  },
})
