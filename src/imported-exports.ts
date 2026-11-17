import type { ESTree } from "@oxlint/plugins"

import type { TextEdit } from "#text-edits.ts"
import { removeStatement, replaceNode } from "#text-edits.ts"

type ImportSpecifierNode = ESTree.ImportDeclaration["specifiers"][number]

/** Returns the identifiers that refer to the name an import specifier declares, from oxlint's scope analysis. */
export type FindReferences = (specifier: ImportSpecifierNode) => ESTree.Node[]

/** The import statement and specifier that bind a top-level name. */
interface ImportBinding {
  declaration: ESTree.ImportDeclaration
  specifier: ImportSpecifierNode
}

/** An `export { ... }` statement, its module's text, and how to find the references to an import. */
interface ExportStatementContext {
  sourceText: string
  statement: ESTree.ExportNamedDeclaration
  findReferences: FindReferences
}

/** A name an `export { ... }` statement exports, the import that binds it, and whether it's exported as a type. */
export interface ImportedExport extends ImportBinding {
  exportSpecifier: ESTree.ExportSpecifier
  isType: boolean
}

/** Returns the import that binds each top-level name. */
export const mapImportBindings = (program: ESTree.Program): Map<string, ImportBinding> => {
  const bindings = new Map<string, ImportBinding>()
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue
    for (const specifier of statement.specifiers)
      bindings.set(specifier.local.name, { declaration: statement, specifier })
  }
  return bindings
}

/** Returns a module export name as it's written, with the quotes of a string name. */
const formatName = (name: ESTree.ModuleExportName): string =>
  name.type === "Literal" ? (name.raw ?? JSON.stringify(name.value)) : name.name

/** Returns an import's specifier as it's written, so the fix keeps its quote style. */
const formatSource = (source: ESTree.StringLiteral): string => source.raw ?? JSON.stringify(source.value)

/** Returns `name`, or `name as alias` when they differ. */
const formatAlias = (name: string, alias: string): string => (name === alias ? name : `${name} as ${alias}`)

/** Returns `";"` when a statement ends with a semicolon, so a statement that replaces it matches. */
const getSemicolon = (sourceText: string, statement: ESTree.Node): string =>
  sourceText[statement.end - 1] === ";" ? ";" : ""

/**
 * Returns the imported name behind each name an `export { ... }` statement exports, or `undefined` when one of them
 * isn't imported.
 */
export const findImportedExports = (
  statement: ESTree.ExportNamedDeclaration,
  bindings: Map<string, ImportBinding>,
): ImportedExport[] | undefined => {
  const importedExports = statement.specifiers.flatMap((exportSpecifier) => {
    const binding = exportSpecifier.local.type === "Literal" ? undefined : bindings.get(exportSpecifier.local.name)
    if (binding === undefined) return []

    const isTypeSpecifier = binding.specifier.type === "ImportSpecifier" && binding.specifier.importKind === "type"
    const isType =
      statement.exportKind === "type"
      || exportSpecifier.exportKind === "type"
      || binding.declaration.importKind === "type"
      || isTypeSpecifier
    return [{ declaration: binding.declaration, specifier: binding.specifier, exportSpecifier, isType }]
  })
  return importedExports.length === statement.specifiers.length ? importedExports : undefined
}

/** Returns the re-export statements that export what `importedExports` export from one import's module. */
const formatImportReexports = (source: string, importedExports: ImportedExport[]): string[] => {
  const namedParts: { text: string; isType: boolean }[] = []
  const namespaceReexports: string[] = []
  for (const { specifier, exportSpecifier, isType } of importedExports) {
    const exportedName = formatName(exportSpecifier.exported)
    if (specifier.type === "ImportNamespaceSpecifier") {
      namespaceReexports.push(`export ${isType ? "type " : ""}* as ${exportedName} from ${source}`)
      continue
    }
    const importedName = specifier.type === "ImportDefaultSpecifier" ? "default" : formatName(specifier.imported)
    namedParts.push({ text: formatAlias(importedName, exportedName), isType })
  }
  if (namedParts.length === 0) return namespaceReexports

  const isTypeOnly = namedParts.every(({ isType }) => isType)
  const names = namedParts.map(({ text, isType }) => (isType && !isTypeOnly ? `type ${text}` : text))
  return [`export ${isTypeOnly ? "type " : ""}{ ${names.join(", ")} } from ${source}`, ...namespaceReexports]
}

/** Returns the re-export statements that export what `importedExports` export, grouped by the import they come from. */
const formatReexports = (importedExports: ImportedExport[]): string[] => {
  const reexports: string[] = []
  for (const [declaration, group] of Map.groupBy(importedExports, (importedExport) => importedExport.declaration))
    reexports.push(...formatImportReexports(formatSource(declaration.source), group))
  return reexports
}

/** Returns an import statement that keeps only `specifiers` of `declaration`. */
const formatImport = (declaration: ESTree.ImportDeclaration, specifiers: ImportSpecifierNode[]): string => {
  const defaultSpecifier = specifiers.find((specifier) => specifier.type === "ImportDefaultSpecifier")
  const namespaceSpecifier = specifiers.find((specifier) => specifier.type === "ImportNamespaceSpecifier")
  const names = specifiers
    .filter((specifier) => specifier.type === "ImportSpecifier")
    .map((specifier) => {
      const name = formatAlias(formatName(specifier.imported), specifier.local.name)
      return specifier.importKind === "type" ? `type ${name}` : name
    })
  const clauses = [
    defaultSpecifier?.local.name,
    namespaceSpecifier && `* as ${namespaceSpecifier.local.name}`,
    names.length > 0 ? `{ ${names.join(", ")} }` : undefined,
  ].filter((clause) => clause !== undefined)
  const typeKeyword = declaration.importKind === "type" ? "type " : ""
  return `import ${typeKeyword}${clauses.join(", ")} from ${formatSource(declaration.source)}`
}

/** Reports whether anything outside the export statement refers to the name an import specifier declares. */
const isUsedOutsideStatement = (
  { statement, findReferences }: ExportStatementContext,
  specifier: ImportSpecifierNode,
): boolean => findReferences(specifier).some(({ start, end }) => start < statement.start || end > statement.end)

/** Returns the edits that drop each imported name the module uses only to export it. */
const findImportEdits = (context: ExportStatementContext, importedExports: ImportedExport[]): TextEdit[] => {
  const { sourceText } = context
  const unusedSpecifiers = new Set(
    importedExports
      .filter(({ specifier }) => !isUsedOutsideStatement(context, specifier))
      .map(({ specifier }) => specifier),
  )
  const declarations = new Set(importedExports.map(({ declaration }) => declaration))
  return [...declarations].flatMap((declaration) => {
    const keptSpecifiers = declaration.specifiers.filter((specifier) => !unusedSpecifiers.has(specifier))
    if (keptSpecifiers.length === declaration.specifiers.length) return []
    if (keptSpecifiers.length === 0) return [removeStatement(sourceText, declaration)]

    const semicolon = getSemicolon(sourceText, declaration)
    return [replaceNode(declaration, `${formatImport(declaration, keptSpecifiers)}${semicolon}`)]
  })
}

/**
 * Returns the edits that turn an `export { ... }` of imported names into re-exports, and drop the imports nothing else
 * uses. Returns `undefined` for an import with attributes or a phase, because the fix doesn't carry them over.
 */
export const buildReexportEdits = (
  context: ExportStatementContext,
  importedExports: ImportedExport[],
): TextEdit[] | undefined => {
  const canReexport = importedExports.every(
    ({ declaration }) => declaration.attributes.length === 0 && !declaration.phase,
  )
  if (!canReexport) return undefined

  const semicolon = getSemicolon(context.sourceText, context.statement)
  const reexports = formatReexports(importedExports).map((reexport) => `${reexport}${semicolon}`)
  return [replaceNode(context.statement, reexports.join("\n")), ...findImportEdits(context, importedExports)]
}
