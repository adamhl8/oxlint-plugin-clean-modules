import fs from "node:fs"
import path from "node:path"

import { absToSubpath, loadImportsMap, subpathToAbs } from "#imports/imports-map.ts"

// Match the extensions an import can name and still resolve to a TypeScript file, an empty one included.
// https://www.typescriptlang.org/docs/handbook/modules/reference.html#file-extension-substitution
export const TS_EXTENSION_SLOTS = ["", ".js", ".jsx", ".ts", ".tsx"]

// Try the TypeScript extensions in this order when looking for a module on disk.
const ALLOWED_EXTENSIONS = [".ts", ".tsx", ".d.ts"]

/** Reports whether a specifier is relative, like `./foo.ts` or `..`. */
export const isRelativeSpecifier = (specifier: string): boolean =>
  specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")

/** Reports whether a specifier is a subpath import, like `#foo.ts`. */
const isSubpathSpecifier = (specifier: string): boolean => specifier.startsWith("#")

/**
 * Returns the path a local specifier points to, from a relative path or a `#` subpath import. Returns `undefined` for a
 * package's specifier, or a subpath import that no `imports` entry matches.
 */
export const resolveSpecifier = (importerPath: string, specifier: string): string | undefined => {
  if (isRelativeSpecifier(specifier)) return path.resolve(path.dirname(importerPath), specifier)
  if (!isSubpathSpecifier(specifier)) return undefined

  const importsMap = loadImportsMap(importerPath)
  return importsMap && subpathToAbs(specifier, importsMap)
}

/** Returns the `#` subpath import that points to `targetPath`, from the `imports` map nearest the importer. */
export const toSubpathSpecifier = (importerPath: string, targetPath: string): string | undefined => {
  const importsMap = loadImportsMap(importerPath)
  return importsMap && absToSubpath(targetPath, importsMap)
}

/** Returns the TypeScript extension a module has on disk, whatever extension `modulePath` names. */
export const findOnDiskExtension = (modulePath: string): string | undefined => {
  const { dir, name } = path.parse(modulePath)
  // Leave out `base`, because `path.format` prefers it over `ext`.
  return ALLOWED_EXTENSIONS.find((extension) => fs.existsSync(path.format({ dir, name, ext: extension })))
}

/** Reports whether a path is a directory on disk. */
export const isExistingDirectory = (directoryPath: string): boolean => {
  // Keep the `catch`, because `statSync` still throws on errors like EACCES, and on ENOTDIR under Bun.
  try {
    return fs.statSync(directoryPath, { throwIfNoEntry: false })?.isDirectory() ?? false
  } catch {
    return false
  }
}

/** Returns the `index` file of a directory, or `undefined` when the path isn't a directory or has none. */
export const findDirectoryIndex = (directoryPath: string): string | undefined => {
  if (!isExistingDirectory(directoryPath)) return undefined

  return ALLOWED_EXTENSIONS.map((extension) => path.join(directoryPath, `index${extension}`)).find((indexPath) =>
    fs.existsSync(indexPath),
  )
}
