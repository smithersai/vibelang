# Approval service

One release program asks an `Approval` service for staging and production approval.
The automatic implementation approves both requests. The scripted reviewer uses
supplied answers and defaults to denial when the script runs out. The business
function depends on `Approval`, without choosing the implementation.

From this directory, with `vibelang` on `PATH`:

```sh
bun install
bun run build
bun run start
```

Features: a `service` declaration, an explicit service lookup with `try`, and
local implementations supplied by `provide`. The corresponding Effect TypeScript
business program is:

```ts
const release = Effect.fnUntraced(function* (version: string) {
  const approval = yield* Approval
  if (!(yield* approval.approve(`deploy ${version} to staging`))) return "staging declined"
  if (!(yield* approval.approve(`deploy ${version} to production`))) return "production declined"
  return `released ${version}`
})
```

The example shows the same business program succeeding automatically and declining
production under the scripted policy. Its earlier exported `Control` key was
redesigned as a service; that changes the key's public declaration. The safe
`vibelang --fix` migration therefore refuses the old exported declaration.
