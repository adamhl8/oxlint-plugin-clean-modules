import type { Context, ESTree, Visitor } from "@oxlint/plugins"

/** What's wrong with an import's specifier, and the specifier to write instead when a rule can fix it. */
export interface SpecifierProblem {
  messageId: string
  data: Record<string, string>
  replacement?: string
}

type CheckSpecifier = (specifier: string) => SpecifierProblem | undefined

type ImportStatement =
  | ESTree.ImportDeclaration
  | ESTree.ImportExpression
  | ESTree.ExportNamedDeclaration
  | ESTree.ExportAllDeclaration

/**
 * Returns visitors that check the specifier of every import, dynamic `import()`, and re-export with `checkSpecifier`,
 * and report the problem it finds.
 */
export const checkImportSources = (context: Context, checkSpecifier: CheckSpecifier): Visitor => {
  const checkImport = (node: ImportStatement) => {
    const { source } = node
    if (source?.type !== "Literal" || typeof source.value !== "string") return

    const problem = checkSpecifier(source.value)
    if (problem === undefined) return

    const { messageId, data, replacement } = problem
    // Replace only the text between the quotes, so the fix keeps the quote style.
    const [start, end] = source.range
    context.report({
      node: source,
      messageId,
      data,
      fix: (fixer) =>
        replacement === undefined ? undefined : fixer.replaceTextRange([start + 1, end - 1], replacement),
    })
  }

  return {
    ImportDeclaration: checkImport,
    ImportExpression: checkImport,
    ExportNamedDeclaration: checkImport,
    ExportAllDeclaration: checkImport,
  }
}
