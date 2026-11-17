# @adamhl8/oxlint-plugin-clean-modules

An [oxlint](https://oxc.rs/docs/guide/usage/linter) plugin with three rules for keeping module imports and exports clean in TypeScript projects:

- [`require-subpath-imports`](#require-subpath-imports) -> ban relative imports in favor of native [Node.js subpath imports](https://nodejs.org/api/packages.html#subpath-imports)
- [`require-direct-exports`](#require-direct-exports) -> require `export` on the declaration instead of a separate `export { ... }`
- [`require-import-extensions`](#require-import-extensions) -> require the correct explicit file extension on local imports

All three rules are auto-fixable.

---

<!-- toc -->

- [Installation](#installation)
- [Usage](#usage)
- [Rules](#rules)
  - [`require-subpath-imports`](#require-subpath-imports)
  - [`require-direct-exports`](#require-direct-exports)
  - [`require-import-extensions`](#require-import-extensions)

<!-- tocstop -->

## Installation

```bash
bun add -D @adamhl8/oxlint-plugin-clean-modules
```

This plugin targets [oxlint's JavaScript plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins), which are in alpha, and needs oxlint 1.91 or later.

## Usage

Add the plugin to `jsPlugins` and enable the rules in your `.oxlintrc.json`. The rule prefix is `clean-modules`:

```json
{
  "jsPlugins": ["@adamhl8/oxlint-plugin-clean-modules"],
  "rules": {
    "clean-modules/require-subpath-imports": "error",
    "clean-modules/require-direct-exports": "error",
    "clean-modules/require-import-extensions": "error"
  }
}
```

Run `oxlint --fix` to apply fixes. Because `require-subpath-imports` and `require-import-extensions` can both rewrite the same import (`./foo` -> `#foo` -> `#foo.ts`), full convergence may take more than one `--fix` pass.

## Rules

### `require-subpath-imports`

Relative imports (`.`, `..`, `./`, `../`) are banned. Imports of modules within the same package should use a native Node.js subpath import, defined by the `imports` field in `package.json`.

The fix resolves the relative import to the matching `#` subpath. A directory import resolves to the directory's `index` file (`index.ts`, `index.tsx`, or `index.d.ts`), since ESM has no directory resolution. If no subpath entry matches, the import is reported without a fix.

```jsonc
// package.json
{ "imports": { "#*": "./src/*" } }
```

<!-- oxfmt-ignore -->
```ts
import { foo } from "./foo" // error
import { foo } from "#foo" // autofixed

import { foo } from "." // error (directory import)
import { foo } from "#index.ts" // autofixed
```

Applies to `import`, dynamic `import()`, `export ... from`, and `export *`.

#### Options

- `ignore: string[]` - skip any import whose specifier contains one of these substrings (useful for cross-package relative imports that legitimately can't map to a subpath).

```json
{ "clean-modules/require-subpath-imports": ["error", { "ignore": ["@generated"] }] }
```

### `require-direct-exports`

Exports should be declared directly on the declaration. Indirect exports (`export { foo }`, `export { foo as bar }`) and re-exports (`export { x } from "..."`, `export * from "..."`) are banned. This is the inverse of [`import/no-named-export`](https://github.com/oxc-project/oxc/blob/main/crates/oxc_linter/src/rules/import/no_named_export.rs).

The rule checks a module's own top-level exports, so it leaves the exports inside a `declare module` block alone.

The fix only handles the safe cases:

- A local, non-renamed `export { foo }` where `foo` is a top-level declaration in the same file. It prepends `export` to the declaration and removes the statement.
- An empty `export {}` in a module that has another import or export. It removes the statement. When `export {}` is the only one, removing it would make the file a script, so it's reported without a fix.

Renamed exports, re-exports, and multi-declarator cases are reported without a fix.

```ts
const foo = 1
export { foo } // error

export const foo = 1 // autofixed
```

#### Index files

An `index.*` file is an entry point, where re-exports belong, so the rule allows `export { x } from "..."` and `export * from "..."` there. Everything else is checked as in any other file.

An `export { ... }` of names the index file imports is a re-export split in two, so it's reported, and fixed into one `export ... from` per import. The fix keeps renames, `default`, namespace, and type imports, and removes each import the file doesn't use otherwise. It finds other uses with oxlint's scope analysis, so a use as a type counts, and a comment, a string, or a property with the same name doesn't. An import with attributes, like `with { type: "json" }`, is reported without a fix.

```ts
import { foo } from "./foo"
export { foo } // error

export { foo } from "./foo" // autofixed
```

#### Options

- `allowEmpty: boolean` (default `false`) - allow the empty `export {}` module marker.

### `require-import-extensions`

Local imports (relative and `#` subpath) must use the correct file extension as it exists on disk (`.ts`, `.tsx`, or `.d.ts`). Extensions are resolved by checking the filesystem, following [TypeScript's extension substitution](https://www.typescriptlang.org/docs/handbook/modules/reference.html#file-extension-substitution). Non-TypeScript extensions (`.json`, `.css`, ...) pass through unchanged. A directory import is rewritten to its explicit `index` file (e.g. `./dir` -> `./dir/index.ts`); a directory with no `index.{ts,tsx,d.ts}` is reported without a fix. If the target file can't be found, the import is reported without a fix.

```ts
import { foo } from "./foo" // error (foo.ts on disk)
import { foo } from "./foo.ts" // autofixed
```
