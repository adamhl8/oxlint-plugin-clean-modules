import fs from "node:fs"
import path from "node:path"

interface SubpathEntry {
  keyPrefix: string
  keySuffix: string
  hasStar: boolean
  /** Absolute path of the target before any `*` (the full target for non-`*` entries). */
  targetPrefix: string
  targetSuffix: string
}

export interface ImportsMap {
  pkgDir: string
  entries: SubpathEntry[]
}

// `*` can match path segments containing "/", so we can't resolve the pre-`*` part on its own
// (path.resolve would drop its trailing slash). Resolve the whole target with the `*` standing in
// as a NUL char (can't appear in a file path) that survives normalization, then split it back out.
const STAR_SENTINEL = "\u0000"

const CONDITION_PRIORITY = ["import", "module", "node", "default", "require"]

const dirCache = new Map<string, ImportsMap | undefined>()
const pkgCache = new Map<string, ImportsMap | undefined>()

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"

const findPackageJson = (startDir: string): string | undefined => {
  for (let dir = startDir; ;) {
    const candidate = path.join(dir, "package.json")
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Resolve a subpath target (string or conditions object/array) to a relative `./` path string. */
const resolveConditionalTarget = (target: unknown): string | undefined => {
  if (typeof target === "string") return target.startsWith("./") ? target : undefined
  if (Array.isArray(target)) {
    for (const value of target) {
      const resolved = resolveConditionalTarget(value)
      if (resolved) return resolved
    }
    return undefined
  }
  if (isRecord(target)) {
    for (const condition of CONDITION_PRIORITY) {
      if (Object.hasOwn(target, condition)) {
        const resolved = resolveConditionalTarget(target[condition])
        if (resolved) return resolved
      }
    }
    for (const value of Object.values(target)) {
      const resolved = resolveConditionalTarget(value)
      if (resolved) return resolved
    }
  }
  return undefined
}

const parseEntry = (key: string, target: unknown, pkgDir: string): SubpathEntry | undefined => {
  if (!key.startsWith("#")) return undefined
  const resolvedTarget = resolveConditionalTarget(target)
  if (!resolvedTarget) return undefined

  const keyStar = key.indexOf("*")
  const targetStar = resolvedTarget.indexOf("*")
  // A `*` must appear in both the key and the target, or neither (anything else is invalid config).
  if ((keyStar === -1) !== (targetStar === -1)) return undefined

  if (keyStar === -1) {
    return {
      keyPrefix: key,
      keySuffix: "",
      hasStar: false,
      targetPrefix: path.resolve(pkgDir, resolvedTarget),
      targetSuffix: "",
    }
  }

  const resolvedFull = path.resolve(pkgDir, resolvedTarget.replace("*", STAR_SENTINEL))
  const sentinelIdx = resolvedFull.indexOf(STAR_SENTINEL)
  return {
    keyPrefix: key.slice(0, keyStar),
    keySuffix: key.slice(keyStar + 1),
    hasStar: true,
    targetPrefix: resolvedFull.slice(0, sentinelIdx),
    targetSuffix: resolvedFull.slice(sentinelIdx + STAR_SENTINEL.length),
  }
}

const parsePackageImports = (pkgPath: string): ImportsMap | undefined => {
  if (pkgCache.has(pkgPath)) return pkgCache.get(pkgPath)

  let map: ImportsMap | undefined
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    const importsField =
      parsed !== null && typeof parsed === "object" && "imports" in parsed ? parsed.imports : undefined
    if (isRecord(importsField)) {
      const pkgDir = path.dirname(pkgPath)
      const entries: SubpathEntry[] = []
      for (const [key, target] of Object.entries(importsField)) {
        const entry = parseEntry(key, target, pkgDir)
        if (entry) entries.push(entry)
      }
      if (entries.length > 0) map = { pkgDir, entries }
    }
  } catch {
    map = undefined
  }

  pkgCache.set(pkgPath, map)
  return map
}

/** Nearest package.json `imports` map for the file, or undefined if none is found/defined. Cached. */
export const loadImportsMap = (filename: string): ImportsMap | undefined => {
  const startDir = path.dirname(filename)
  if (dirCache.has(startDir)) return dirCache.get(startDir)

  const pkgPath = findPackageJson(startDir)
  const map = pkgPath ? parsePackageImports(pkgPath) : undefined
  dirCache.set(startDir, map)
  return map
}

const toPosix = (value: string): string => value.split(path.sep).join("/")

/** Map an absolute file path to its `#` subpath specifier, picking the most specific entry. */
export const absToSubpath = (absPath: string, map: ImportsMap): string | undefined => {
  let best: { specifier: string; prefixLen: number; suffixLen: number } | undefined
  for (const entry of map.entries) {
    let specifier: string | undefined
    if (entry.hasStar) {
      if (
        absPath.length >= entry.targetPrefix.length + entry.targetSuffix.length
        && absPath.startsWith(entry.targetPrefix)
        && absPath.endsWith(entry.targetSuffix)
      ) {
        const mid = absPath.slice(entry.targetPrefix.length, absPath.length - entry.targetSuffix.length)
        specifier = entry.keyPrefix + toPosix(mid) + entry.keySuffix
      }
    } else if (absPath === entry.targetPrefix) specifier = entry.keyPrefix

    if (specifier === undefined) continue
    if (
      !best
      || entry.targetPrefix.length > best.prefixLen
      || (entry.targetPrefix.length === best.prefixLen && entry.targetSuffix.length > best.suffixLen)
    )
      best = { specifier, prefixLen: entry.targetPrefix.length, suffixLen: entry.targetSuffix.length }
  }
  return best?.specifier
}

/** Map a `#` subpath specifier to its absolute target path, picking the most specific entry. */
export const subpathToAbs = (specifier: string, map: ImportsMap): string | undefined => {
  let best: { abs: string; prefixLen: number; suffixLen: number } | undefined
  for (const entry of map.entries) {
    let abs: string | undefined
    if (entry.hasStar) {
      if (
        specifier.length >= entry.keyPrefix.length + entry.keySuffix.length
        && specifier.startsWith(entry.keyPrefix)
        && specifier.endsWith(entry.keySuffix)
      ) {
        const mid = specifier.slice(entry.keyPrefix.length, specifier.length - entry.keySuffix.length)
        abs = path.normalize(entry.targetPrefix + mid + entry.targetSuffix)
      }
    } else if (specifier === entry.keyPrefix) abs = entry.targetPrefix

    if (abs === undefined) continue
    if (
      !best
      || entry.keyPrefix.length > best.prefixLen
      || (entry.keyPrefix.length === best.prefixLen && entry.keySuffix.length > best.suffixLen)
    )
      best = { abs, prefixLen: entry.keyPrefix.length, suffixLen: entry.keySuffix.length }
  }
  return best?.abs
}
