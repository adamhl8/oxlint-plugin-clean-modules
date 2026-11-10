import path from "node:path"

import type { Context } from "@oxlint/plugins"
import { defineRule } from "@oxlint/plugins"

import type { SpecifierProblem } from "#import-sources.ts"
import { checkImportSources } from "#import-sources.ts"
import { findDirectoryIndex, isRelativeSpecifier, toSubpathSpecifier } from "#imports/imports.ts"
import { getOptionsObject } from "#rule-options.ts"

/** Returns the `ignore` option: the substrings that exempt a specifier that contains one. */
export const readIgnoreOption = (options: Context["options"]): string[] => {
  const { ignore } = getOptionsObject(options)
  return Array.isArray(ignore) ? ignore.filter((entry) => typeof entry === "string") : []
}

/**
 * Returns the problem with a relative specifier, and the subpath import to write instead when one points to the same
 * module. Returns `undefined` for any other specifier, and for one that contains an `ignore` entry.
 */
export const checkSubpathImport = (
  importerPath: string,
  specifier: string,
  ignore: readonly string[],
): SpecifierProblem | undefined => {
  if (!isRelativeSpecifier(specifier)) return undefined
  if (ignore.some((entry) => specifier.includes(entry))) return undefined

  const targetPath = path.resolve(path.dirname(importerPath), specifier)
  // Point at a directory's `index` file, because ESM has no directory resolution.
  const subpath = toSubpathSpecifier(importerPath, findDirectoryIndex(targetPath) ?? targetPath)
  if (subpath === undefined) return { messageId: "noSubpathMatch", data: { specifier } }

  return { messageId: "relativeImport", data: { specifier, subpath }, replacement: subpath }
}

export const requireSubpathImports = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow relative imports; require Node.js subpath imports (`#...`)." },
    fixable: "code",
    schema: [
      {
        type: "object",
        properties: { ignore: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      relativeImport: "Relative import '{{specifier}}' is not allowed; use the subpath import '{{subpath}}'.",
      noSubpathMatch:
        "Relative import '{{specifier}}' is not allowed, but no matching subpath import was found in package.json `imports`.",
    },
  },
  create: (context) => {
    const ignore = readIgnoreOption(context.options)
    return checkImportSources(context, (specifier) => checkSubpathImport(context.filename, specifier, ignore))
  },
})
