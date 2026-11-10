import { beforeAll, describe, expect, it } from "bun:test"
import path from "node:path"

import { copyFixture } from "@adamhl8/configs/test"
import bun, { $ } from "bun"

const REPO_DIRECTORY = path.resolve(import.meta.dir, "../..")
const FIXTURE_DIRECTORY = path.join(import.meta.dir, "fixtures", "oxlint-project")
const PLUGIN_PATH = path.join(REPO_DIRECTORY, "dist/index.js")
const OXLINT_BIN = path.join(REPO_DIRECTORY, "node_modules/.bin/oxlint")
const TSDOWN_BIN = path.join(REPO_DIRECTORY, "node_modules/.bin/tsdown")

const RULE_PREFIX = "clean-modules("

const OXLINT_CONFIG = {
  jsPlugins: [PLUGIN_PATH],
  rules: {
    "clean-modules/require-subpath-imports": "error",
    "clean-modules/require-direct-exports": "error",
    "clean-modules/require-import-extensions": "error",
  },
}

/** Copies the fixture project with a config that enables every rule, and returns the copy's folder. */
const copyFixtureProject = async (): Promise<string> => {
  const { dir } = await copyFixture(FIXTURE_DIRECTORY)
  await bun.write(path.join(dir, ".oxlintrc.json"), JSON.stringify(OXLINT_CONFIG))
  return dir
}

/** Lints a project with oxlint, and returns the plugin's diagnostics, one line each, sorted. */
const lintProject = async (directory: string): Promise<string[]> => {
  // Read the output whatever the exit code, because oxlint exits non-zero when it finds problems.
  // Pin `--format=unix`, because oxlint switches to a compact format when it detects an AI agent.
  const output = await $`${OXLINT_BIN} --format=unix`.cwd(directory).nothrow().quiet().text()
  return output
    .split("\n")
    .filter((line) => line.includes(RULE_PREFIX))
    .toSorted()
}

beforeAll(async () => {
  // Build first, because oxlint loads the plugin from `dist/`.
  await $`${TSDOWN_BIN}`.cwd(REPO_DIRECTORY).quiet()
})

describe("the plugin in oxlint", () => {
  it("should report each rule's problems, and nothing in a barrel file", async () => {
    const directory = await copyFixtureProject()

    expect(await lintProject(directory)).toStrictEqual([
      "src/helper.ts:2:1: Add `export` directly to the declaration instead of a separate `export { ... }` statement. [Error/clean-modules(require-direct-exports)]",
      "src/main.ts:1:23: Import './helper' should use the file extension '.ts'. [Error/clean-modules(require-import-extensions)]",
      "src/main.ts:1:23: Relative import './helper' is not allowed; use the subpath import '#helper'. [Error/clean-modules(require-subpath-imports)]",
      "src/main.ts:3:27: Import './helper' should use the file extension '.ts'. [Error/clean-modules(require-import-extensions)]",
      "src/main.ts:3:27: Relative import './helper' is not allowed; use the subpath import '#helper'. [Error/clean-modules(require-subpath-imports)]",
      "src/reexports.ts:1:1: Re-exports are not allowed here; export directly on the declaration in the defining module. [Error/clean-modules(require-direct-exports)]",
      "src/reexports.ts:1:23: Import './helper' should use the file extension '.ts'. [Error/clean-modules(require-import-extensions)]",
      "src/reexports.ts:1:23: Relative import './helper' is not allowed; use the subpath import '#helper'. [Error/clean-modules(require-subpath-imports)]",
      "src/reexports.ts:2:15: Import './helper' should use the file extension '.ts'. [Error/clean-modules(require-import-extensions)]",
      "src/reexports.ts:2:15: Relative import './helper' is not allowed; use the subpath import '#helper'. [Error/clean-modules(require-subpath-imports)]",
      "src/reexports.ts:2:1: Re-exports are not allowed here; export directly on the declaration in the defining module. [Error/clean-modules(require-direct-exports)]",
    ])
  })

  it("should fix every problem it can, keeping the quote style", async () => {
    const directory = await copyFixtureProject()

    // Run `--fix` twice, because the subpath and extension fixes both rewrite the same import, and oxlint applies one
    // of them in each pass.
    await $`${OXLINT_BIN} --fix`.cwd(directory).nothrow().quiet()
    await $`${OXLINT_BIN} --fix`.cwd(directory).nothrow().quiet()

    const readSource = async (modulePath: string) => bun.file(path.join(directory, "src", modulePath)).text()
    expect(await readSource("main.ts")).toBe(
      "import { value } from '#helper.ts'\n\nconst lazyHelper = import(\"#helper.ts\")\n\nconsole.log(value, lazyHelper)\n",
    )
    expect(await readSource("helper.ts")).toBe("export const value = 1\n\n")
    expect(await readSource("reexports.ts")).toBe('export { value } from "#helper.ts"\nexport * from "#helper.ts"\n')
    expect(await lintProject(directory)).toStrictEqual([
      "src/reexports.ts:1:1: Re-exports are not allowed here; export directly on the declaration in the defining module. [Error/clean-modules(require-direct-exports)]",
      "src/reexports.ts:2:1: Re-exports are not allowed here; export directly on the declaration in the defining module. [Error/clean-modules(require-direct-exports)]",
    ])
  })
})
