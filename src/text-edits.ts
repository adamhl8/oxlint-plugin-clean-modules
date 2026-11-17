import type { ESTree } from "@oxlint/plugins"

/** A replacement of the source text in `range`. An empty `text` removes the range. */
export interface TextEdit {
  range: [number, number]
  text: string
}

/** Returns an edit that removes a statement, and the line break after it, so no blank line is left. */
export const removeStatement = (sourceText: string, statement: ESTree.Node): TextEdit => {
  const end = sourceText[statement.end] === "\n" ? statement.end + 1 : statement.end
  return { range: [statement.start, end], text: "" }
}

/** Returns an edit that replaces a node's text. */
export const replaceNode = (node: ESTree.Node, text: string): TextEdit => ({ range: [node.start, node.end], text })
