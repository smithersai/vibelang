# Comptime, validation, and assets

Read this only for compile-time evaluation, derived runtime artifacts, or non-code imports.

- `comptime expr` requires deterministic compile-time evaluation and may produce values or types. Failure to evaluate is a compile error; ordinary constant folding needs no marker.
- Comptime has no ambient filesystem, network, environment, clock, random, mutable globals, or runtime capabilities. Compiler-tracked imports/embedding are allowed and become dependency edges.
- Ordinary types can derive runtime artifacts: `const UserSchema = comptime Schema.derive<User>()`. Parse external `unknown` data with the derived schema; validation errors use the normal typed failure channel.
- `comptime.target` selects target-specific implementations; unselected branches are not emitted.
- JSON, Markdown, and MDX are compiler-known typed modules. Custom loaders can produce values and types from formats such as SQL or GraphQL. Loader inputs, implementation/options, target, and transitive tracked imports form the cache identity.

Const JSON imports are deeply readonly and literal-preserving, but their exact import grammar is open. Loader registration and the standard Markdown/MDX module shapes are also open; follow current project conventions rather than inventing stable syntax.

