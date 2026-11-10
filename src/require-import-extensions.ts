import path from "node:path"

import { defineRule } from "@oxlint/plugins"

import type { SpecifierProblem } from "#import-sources.ts"
import { checkImportSources } from "#import-sources.ts"
import {
  findDirectoryIndex,
  findOnDiskExtension,
  isExistingDirectory,
  resolveSpecifier,
  TS_EXTENSION_SLOTS,
} from "#imports/imports.ts"

/**
 * Returns the problem with a local specifier whose extension doesn't match the TypeScript module on disk, and the
 * specifier to write instead when the module exists. Returns `undefined` for a correct specifier, a package's
 * specifier, and an extension TypeScript doesn't substitute, like `.json`.
 */
export const checkImportExtension = (importerPath: string, specifier: string): SpecifierProblem | undefined => {
  // Leave an unresolvable subpath import to `require-subpath-imports`, which checks the `imports` map.
  const targetPath = resolveSpecifier(importerPath, specifier)
  if (targetPath === undefined) return undefined

  const currentExtension = path.parse(specifier).ext
  if (!TS_EXTENSION_SLOTS.includes(currentExtension)) return undefined

  const extension = findOnDiskExtension(targetPath)
  if (extension === currentExtension) return undefined
  if (extension !== undefined) {
    const replacement = `${specifier.slice(0, specifier.length - currentExtension.length)}${extension}`
    return { messageId: "wrongExtension", data: { specifier, expected: extension }, replacement }
  }

  const indexPath = findDirectoryIndex(targetPath)
  if (indexPath !== undefined) {
    const separator = specifier.endsWith("/") ? "" : "/"
    const replacement = `${specifier}${separator}${path.basename(indexPath)}`
    return { messageId: "directoryIndex", data: { specifier, index: replacement }, replacement }
  }

  // Leave a directory without an `index` file alone, because no single module stands for it.
  if (isExistingDirectory(targetPath)) return undefined

  const { dir, name } = path.parse(targetPath)
  return { messageId: "targetNotFound", data: { specifier, lookup: `${path.join(dir, name)}.{ts,tsx,d.ts}` } }
}

export const requireImportExtensions = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Require local imports to use the correct explicit file extension." },
    fixable: "code",
    schema: [],
    messages: {
      wrongExtension: "Import '{{specifier}}' should use the file extension '{{expected}}'.",
      targetNotFound: "Import '{{specifier}}' could not be resolved on disk (looked for '{{lookup}}').",
      directoryIndex: "Import '{{specifier}}' resolves to a directory; import its index file '{{index}}' explicitly.",
    },
  },
  create: (context) => checkImportSources(context, (specifier) => checkImportExtension(context.filename, specifier)),
})
