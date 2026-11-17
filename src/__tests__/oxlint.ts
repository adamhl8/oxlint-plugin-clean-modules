import path from "node:path"

import { $ } from "bun"

const REPO_DIRECTORY = path.resolve(import.meta.dir, "../..")
const TSDOWN_BIN = path.join(REPO_DIRECTORY, "node_modules/.bin/tsdown")

export const PLUGIN_PATH = path.join(REPO_DIRECTORY, "dist/index.js")
export const OXLINT_BIN = path.join(REPO_DIRECTORY, "node_modules/.bin/oxlint")

let build: Promise<unknown> | undefined

/** Builds the plugin once per test run, because oxlint loads it from `dist/`. */
export const buildPlugin = async (): Promise<void> => {
  build ??= $`${TSDOWN_BIN}`.cwd(REPO_DIRECTORY).quiet()
  await build
}
