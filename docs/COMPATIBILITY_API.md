# TypeScript compatibility API and CLI

Status: M0 boilerplate. TypeScript input works through upstream TypeScript;
VibeLang grammar and semantics report explicit not-implemented errors.

## Package entry points

The package intentionally keeps TypeScript's compatibility API separate from
VibeLang additions:

| Import | Contract |
| --- | --- |
| `vibelang` | The complete TypeScript 5.9 JavaScript compiler, factory, transform, watch, language-service, `ts.server`, and protocol API |
| `vibelang/tsserverlibrary` | Compatibility alias for the historical tsserver library entry point |
| `vibelang/plugin` | A TypeScript language-service `PluginModuleFactory`; pass-through in M0 |
| `vibelang/vibe` | VibeLang-specific compiler extension contracts and explicit placeholders |
| `vibelang/provider` | Provisional `Layer`, `Action`, `Flow`, and `Durable` M0 scaffolding; not the accepted durable source API |
| `vibelang/unstable/*` | Direct wrappers for TypeScript 7's published unstable sync, async, filesystem, protocol, and AST APIs |

The root is intentionally an identity re-export instead of a handwritten
facsimile. This preserves all public functions, enums, factories, nested
namespaces, compiler hosts, language-service methods, server protocol types,
watch/build APIs, and future patch-level additions from the wrapped TypeScript
5.9 package.

```ts
import ts = require("vibelang")

const source = ts.createSourceFile(
  "example.ts",
  "export const value: number = 1",
  ts.ScriptTarget.Latest,
)
```

TypeScript 7 has not replaced that ecosystem API. Its package root currently
exports its version plus new APIs under `typescript/unstable/*`; VibeLang
mirrors those subpaths separately so consumers can migrate deliberately.

## Language-service plugin

Configure the M0 pass-through plugin with:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "vibelang/plugin" }]
  }
}
```

The plugin uses the `typescript` instance injected by tsserver and decorates
the supplied `LanguageService`, matching TypeScript's plugin ABI. It does not
claim to add `.vibe` grammar. TypeScript language-service plugins affect editor
operations only; they cannot extend parsing, type checking, or command-line
emit. Those capabilities belong in the Go compiler/LSP fork.

## Commands

`vibe` is the Incur command surface:

```sh
vibe compile src/index.ts --no-emit
vibe check src/index.ts
vibe build --verbose
vibe doctor
```

`format`, `test`, and `lsp` exist in the manifest and return structured
`NOT_IMPLEMENTED` errors.

`vibec`, `vtsc`, and the compatibility `tsc` bin forward every raw argument,
in its original order, to the installed native TypeScript 7 compiler. The
`vtsserver` and compatibility `tsserver` bins run the JavaScript TypeScript 5.9
server so existing language-service plugins retain their expected host:

```sh
vibec --project tsconfig.json --noEmit
vtsc --build --verbose
vtsserver
```

This separate path is necessary for compatibility. Incur reserves global flags
and parses command schemas, while existing TypeScript tooling may depend on
exact `tsc` spellings, boolean-value forms, repeated options, and exit codes.

## Known gaps

- `.vibe` and the candidate `.vibex` extension are not parsed.
- Error/requirement rows, comptime, checked VibeLang IR, and lowering are not implemented.
- The accepted compiler-owned `vibelang:comptime` and `vibelang:flows` virtual
  modules are not implemented. They are source intrinsics handled by a future
  VibeLang compiler, not npm runtime entry points. The current provider
  `Flow`/`Durable` exports are compatibility scaffolding and do not supersede
  the documented `comptime(...)` and `durable(...)` forms.
- The accepted compiler-recognized `vibelang/context` API is not implemented.
  The current `vibelang/provider` export is provisional scaffolding only.
- The plugin is pass-through and the VibeLang LSP command is a placeholder.
- TypeScript 7 marks every new API subpath unstable; wrappers may change with upstream.
- The Go compiler cannot import upstream `internal` packages and therefore needs the planned fork.
