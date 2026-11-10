import { definePlugin } from "@oxlint/plugins"

import { requireDirectExports } from "#require-direct-exports.ts"
import { requireImportExtensions } from "#require-import-extensions.ts"
import { requireSubpathImports } from "#require-subpath-imports.ts"

const plugin = definePlugin({
  // `meta.name` is the prefix users type in config, e.g. `clean-modules/require-subpath-imports`.
  meta: { name: "clean-modules" },
  rules: {
    "require-subpath-imports": requireSubpathImports,
    "require-direct-exports": requireDirectExports,
    "require-import-extensions": requireImportExtensions,
  },
})

// oxlint-disable-next-line import/no-default-export - oxlint loads a plugin from its default export
export default plugin
