# Comptime, validation, and assets

Read this only for compile-time evaluation, derived runtime artifacts, or non-code imports.

- Import `comptime` from `vibelang:comptime`; it is a compiler-recognized function, not a keyword. `comptime(value)` requires deterministic build-time evaluation and may produce values or types. `comptime(functionValue)` marks and returns a compile-time function without invoking it.
- Recognition follows the resolved imported binding, so aliases work and unrelated functions named `comptime` remain ordinary. The compiler-owned virtual module has no uncompiled runtime fallback.
- Comptime has no ambient filesystem, network, environment, clock, random, mutable globals, or runtime capabilities. Compiler-tracked imports and embedding are allowed and become dependency edges.
- Ordinary types can derive runtime artifacts: `const UserSchema = comptime(Schema.derive<User>())`. Schema parsing returns `Result<T, ValidationError>`.
- `comptime.target` selects target-specific implementations; unselected branches are not emitted.
- Every non-code and foreign-source import uses import attributes. The `type` selects the loader, and other string attributes configure it.

```ts
import config from "./config.json" with { type: "json" }
import literalConfig from "./config.json" with {
  type: "json",
  mode: "const",
}
import prompt from "./prompt.md" with { type: "text" }
import component from "./prompt.mdx" with { type: "mdx" }
```

JSON `mode: "const"` is deeply readonly and literal-preserving. Loader inputs, implementation, string-valued attributes, target, and transitive tracked imports form the cache identity. Never use the removed comptime keyword form or a separate const-import grammar.
