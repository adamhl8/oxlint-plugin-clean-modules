import path from "node:path"

/** The fixture project the rule tests resolve imports in: its `package.json` maps `#*` and `#utils/*` to `src/`. */
export const PROJECT_DIRECTORY = path.join(import.meta.dir, "fixtures", "project")

/** The module the tests import from. */
export const IMPORTER_PATH = path.join(PROJECT_DIRECTORY, "src", "foo.ts")

/** A module in a project whose `package.json` has no `imports` field. */
export const NO_IMPORTS_IMPORTER_PATH = path.join(PROJECT_DIRECTORY, "no-imports", "foo.ts")
