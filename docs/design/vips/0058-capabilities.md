# VIP-58: Capabilities: a permission kernel in the standard library

**Status:** accepted optimistically, 2026-11-09, under Will's pre-alpha standing approval (ruling 19:19 PST). Will has not reviewed this VIP's decisions.

## Will's words

> Yea good call on capabilities and permission kernal likely being something that should be built into the library itself but not clear. I think I agree with all of these and we should write VIP for all of the.

## Summary

**One sentence.** Permissions are a standard-library module, `Experimental.Capability`, that puts a check in front of every platform service a program can reach, and the language adds no syntax for it.

**One paragraph.** This proposal chooses a library surface over language syntax, for the four reasons below. The module ports Smithers' `@smthrs/capability` and `@smthrs/kernel`. A capability names one operation, such as `fs:write` on `/workspace/out.txt`. A policy is an ordered list of patterns that allow or deny. `Experimental.Capability.guard(policy)` is a layer that replaces `FileSystem`, `HttpClient` and `ChildProcessSpawner` with checked versions, so code that never mentions permission is still checked. A grant decides whether an operation may happen. A ceiling, set with `attenuate`, bounds what any grant can reach, and it only narrows.

```text
 your code            Experimental.Capability.guard(policy)     the host
 ─────────            ─────────────────────────────────────     ────────
 fs.readFileString ─► fs:read  /workspace/README.md  allow ─►  NodeServices.layer
 fs.writeFileString ► fs:write /workspace/out.txt    ask   ─✕   fails: PermissionRequired
 http.post         ─► net:post https://api.x.dev/…   deny  ─✕   fails: PermissionDenied
```

## Decision

```ts
// proposed
export effect function copyReadme() {
  provide Experimental.Capability.guard({ allow: ["fs:read:/workspace/**"] }) {
    const fs = try FileSystem.FileSystem
    const readme = try fs.readFileString("/workspace/README.md")
    try fs.writeFileString("/workspace/out.txt", readme)
  }
}
```

The read succeeds. The write fails: no rule allows `fs:write`.

### Why a library

1. **Injected services are the door.** Vibe code reaches the platform through `FileSystem`, `HttpClient` and `ChildProcessSpawner` ([VIP-33](0033-platform-stdlib.md)). A layer that decorates those tags in place guards every caller, including a library that never heard of the kernel. A second, protected tag would guard only the callers who chose it.
2. **A decision needs run-time facts.** The kernel authorizes a path after resolving it, runs the operation "through a pinned directory descriptor", and rechecks "every redirect hop" (`flows/kernel/README.md`). No type system sees a symlink or a redirect.
3. **Will leans library**, in the words above.
4. **The one static part has a home.** What a durable step may touch is declared on the step: `static readonly tier`, `capabilities` and `effects` on a `task` or `workflow` ([durable-tasks-workflows](0055-durable-tasks-workflows.md)). Those are members, not new grammar.

The compiler contributes without syntax: the plan it derives lists each task's tier and its declared capabilities. A reviewer reads what a workflow may touch before it runs. The plan does not infer authority from a requirement type: `FileSystem` in `R` says a step can ask, not that it may.

### Module

`Experimental.Capability`, in scope with no import, as VIP-33 rules. Its code is `vibelang-runtime/experimental/Capability`. It ports `@smthrs/capability` (vocabulary and evaluation, no state) and `@smthrs/kernel` (enforcement).

| Call | Meaning | Smithers |
| --- | --- | --- |
| `Capability.guard({ allow, deny?, workspace?, attended? })` | A layer that decorates the platform services in place | `HostServices.layer` over `GrantStore.layer({ attended, rules })` and `Workspace.layer(root)` |
| `Capability.attenuate(patterns)(effect)` | Narrow what one Effect may ask for. Nothing widens it again | `CapabilitySet.attenuate` |
| `Capability.evaluate(policy, capability)` | `"allow"`, `"deny"` or `"ask"`, a pure function | `Permission.evaluate` |
| `Capability.tierOf(capability, { workspace })` | `"sealed"`, `"compensable"` or `"irreversible"` | `Capability.tierOf` |
| `Capability.required(error)` | Read a `PermissionRequired` back out of a `PlatformError` | `Permission.fromPlatformError` |
| `Capability.journaled` | A grant store that writes a remembered answer to the run's journal before it takes effect | `JournalGrantStore.layer` |

### Rules

1. **Text form.** A capability is `action:resource`, such as `net:get:https://api.github.com/repos/**`.
2. **Globs.** `*` matches any run of characters, `/` included. `?` matches one. There is no escape, so a resource that holds `*` or `?` cannot be granted exactly. Never build a pattern from an agent's text.
3. **Actions are a closed list**, from `flows/capability/src/Action.ts`: `fs:read`, `fs:write`, `net:get`, `net:post`, `net:private`, `model:call`, `memory:read`, `memory:write`, `proc:spawn`, and nine `jj:*` actions.
4. **Order.** The last rule that matches wins, except that a configured deny is a veto. A request no rule matches is `ask`, never `allow`.
5. **`ask`.** With `attended: false`, `ask` fails with `PermissionRequired`. With `attended: true`, the operation parks on a request a person answers. `guard` defaults to `false`, because a parked request nobody answers hangs a program. Smithers' `GrantStore` defaults to `true`.
6. **Ceilings.** `attenuate` intersects the current ceiling with one more group of patterns. A fiber that never passed through it has no ceiling. A grant cannot reach past a ceiling, and a ceiling grants nothing. A task's `capabilities` member is a ceiling: omitted, it inherits the caller's; `[]` denies every guarded operation.
7. **Failures.** Effect fixes the error type of `fs.writeFileString` to `PlatformError`. The kernel fails with a `PlatformError` whose cause holds the structured `PermissionRequired` or `PermissionDenied`.
8. **Tiers** (`Capability.tierOf`). They govern retry, caching and rollback; they do not grant or forbid.

| Tier | Operations |
| --- | --- |
| `sealed` | `fs:read`, `net:get`, `model:call`, `memory:read` |
| `compensable` | An `fs:write` inside the workspace |
| `irreversible` | `net:post`, `proc:spawn`, `memory:write`, an `fs:write` outside the workspace |

Only an irreversible step needs an idempotency key to retry. Containment is lexical, so the kernel resolves a real path before it classifies a write.

9. **Decorated services.** `FileSystem`, `ChildProcessSpawner` and `HttpClient` are checked. `Path` passes through. Smithers also guards its `Jj` service.

### What it does not guard

- **A `.ts` file or a `module` body** ([VIP-40](0040-module-declarations.md)) reaches the platform directly. The kernel never sees it. VIP-33's ban on platform globals in `.vibe` code keeps authors on the door; it is discipline, not a security proof, and VIP-54 may relax it. Untrusted code needs a process or realm with a fixed service table.
- **A spawned process** does what the operating system lets it. Granting `proc:spawn` for `npm *` grants every npm subcommand and anything appended to the line. Confinement is [std-sandbox](0067-std-sandbox.md)'s job.
- **A capability is not a secret.** [std-secrets](0068-std-secrets.md) keeps values out of a step.
- **A human answer in a workflow is not a grant.** It answers the workflow's question ([durable-waits](0056-durable-waits.md)).

### Host needs

Pure evaluation runs everywhere. Enforcement needs the platform services it decorates, and directory handles for file confinement, which Node and Bun have. A host that cannot confine a path refuses the operation; it does not fall back to a lexical check.

## Claude's decisions

This is the decision record for the design above, including each API signature, rule and diagnostic table entry. The code examples illustrate those decisions. Optimistic acceptance records the authorship below; Will has not reviewed these choices and may overturn them.

- The read succeeds. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#decision) · [Review](reviews/2026-11-09-built-in-set.md).
- The write fails: no rule allows `fs:write`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#decision) · [Review](reviews/2026-11-09-built-in-set.md).
- **Injected services are the door.** Vibe code reaches the platform through `FileSystem`, `HttpClient` and `ChildProcessSpawner` ([VIP-33](0033-platform-stdlib.md)). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- A layer that decorates those tags in place guards every caller, including a library that never heard of the kernel. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- A second, protected tag would guard only the callers who chose it. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- **A decision needs run-time facts.** The kernel authorizes a path after resolving it, runs the operation "through a pinned directory descriptor", and rechecks "every redirect hop" (`flows/kernel/README.md`). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- No type system sees a symlink or a redirect. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- **Will leans library**, in the words above. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- **The one static part has a home.** What a durable step may touch is declared on the step: `static readonly tier`, `capabilities` and `effects` on a `task` or `workflow` ([durable-tasks-workflows](0055-durable-tasks-workflows.md)). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- Those are members, not new grammar. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- The compiler contributes without syntax: the plan it derives lists each task's tier and its declared capabilities. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- A reviewer reads what a workflow may touch before it runs. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- The plan does not infer authority from a requirement type: `FileSystem` in `R` says a step can ask, not that it may. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#why-a-library) · [Review](reviews/2026-11-09-built-in-set.md).
- `Experimental.Capability`, in scope with no import, as VIP-33 rules. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Its code is `vibelang-runtime/experimental/Capability`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- It ports `@smthrs/capability` (vocabulary and evaluation, no state) and `@smthrs/kernel` (enforcement). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Capability.guard({ allow, deny?, workspace?, attended? })`: Meaning: A layer that decorates the platform services in place; Smithers: `HostServices.layer` over `GrantStore.layer({ attended, rules })` and `Workspace.layer(root)`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Capability.attenuate(patterns)(effect)`: Meaning: Narrow what one Effect may ask for. Nothing widens it again; Smithers: `CapabilitySet.attenuate`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Nothing widens it again | `CapabilitySet.attenuate` | Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Capability.evaluate(policy, capability)`: Meaning: `"allow"`, `"deny"` or `"ask"`, a pure function; Smithers: `Permission.evaluate`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Capability.tierOf(capability, { workspace })`: Meaning: `"sealed"`, `"compensable"` or `"irreversible"`; Smithers: `Capability.tierOf`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Capability.required(error)`: Meaning: Read a `PermissionRequired` back out of a `PlatformError`; Smithers: `Permission.fromPlatformError`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- Call `Capability.journaled`: Meaning: A grant store that writes a remembered answer to the run's journal before it takes effect; Smithers: `JournalGrantStore.layer`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#module) · [Review](reviews/2026-11-09-built-in-set.md).
- **Text form.** A capability is `action:resource`, such as `net:get:https://api.github.com/repos/**`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Globs.** `*` matches any run of characters, `/` included. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `?` matches one. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- There is no escape, so a resource that holds `*` or `?` cannot be granted exactly. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Never build a pattern from an agent's text. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Actions are a closed list**, from `flows/capability/src/Action.ts`: `fs:read`, `fs:write`, `net:get`, `net:post`, `net:private`, `model:call`, `memory:read`, `memory:write`, `proc:spawn`, and nine `jj:*` actions. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Order.** The last rule that matches wins, except that a configured deny is a veto. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A request no rule matches is `ask`, never `allow`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **`ask`.** With `attended: false`, `ask` fails with `PermissionRequired`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- With `attended: true`, the operation parks on a request a person answers. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `guard` defaults to `false`, because a parked request nobody answers hangs a program. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Smithers' `GrantStore` defaults to `true`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Ceilings.** `attenuate` intersects the current ceiling with one more group of patterns. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A fiber that never passed through it has no ceiling. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A grant cannot reach past a ceiling, and a ceiling grants nothing. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- A task's `capabilities` member is a ceiling: omitted, it inherits the caller's; `[]` denies every guarded operation. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Failures.** Effect fixes the error type of `fs.writeFileString` to `PlatformError`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- The kernel fails with a `PlatformError` whose cause holds the structured `PermissionRequired` or `PermissionDenied`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Tiers** (`Capability.tierOf`). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- They govern retry, caching and rollback; they do not grant or forbid. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Tier `sealed`: Operations: `fs:read`, `net:get`, `model:call`, `memory:read`. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Tier `compensable`: Operations: An `fs:write` inside the workspace. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Tier `irreversible`: Operations: `net:post`, `proc:spawn`, `memory:write`, an `fs:write` outside the workspace. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Only an irreversible step needs an idempotency key to retry. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Containment is lexical, so the kernel resolves a real path before it classifies a write. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **Decorated services.** `FileSystem`, `ChildProcessSpawner` and `HttpClient` are checked. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- `Path` passes through. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- Smithers also guards its `Jj` service. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#rules) · [Review](reviews/2026-11-09-built-in-set.md).
- **A `.ts` file or a `module` body** ([VIP-40](0040-module-declarations.md)) reaches the platform directly. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- The kernel never sees it. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- VIP-33's ban on platform globals in `.vibe` code keeps authors on the door; it is discipline, not a security proof, and VIP-54 may relax it. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- Untrusted code needs a process or realm with a fixed service table. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- **A spawned process** does what the operating system lets it. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- Granting `proc:spawn` for `npm *` grants every npm subcommand and anything appended to the line. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- Confinement is [std-sandbox](0067-std-sandbox.md)'s job. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- **A capability is not a secret.** [std-secrets](0068-std-secrets.md) keeps values out of a step. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- **A human answer in a workflow is not a grant.** It answers the workflow's question ([durable-waits](0056-durable-waits.md)). Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#what-it-does-not-guard) · [Review](reviews/2026-11-09-built-in-set.md).
- Pure evaluation runs everywhere. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- Enforcement needs the platform services it decorates, and directory handles for file confinement, which Node and Bun have. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).
- A host that cannot confine a path refuses the operation; it does not fall back to a lexical check. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Design](#host-needs) · [Review](reviews/2026-11-09-built-in-set.md).

### Adopted review answers

- Keep `Experimental.X` names under VIP-33. Promotion to a bare module name requires a later decision. Authors: vip-fable (Fable 5.2) and vip-astra (Codex Astra); merged by vip-final (Fable 5.2); adopted by lang-5e. [Review question 1](reviews/2026-11-09-built-in-set.md#1-experimentalagent-or-agent).

## Compared

The same program in Smithers 1.x. It type-checks against `@smthrs/kernel` 1.0.0-rc.16.

```ts
import { Capability, GrantStore, HostServices, Permission, Workspace } from "@smthrs/kernel"
import { Effect, FileSystem, Layer } from "effect"

const allow = (action: Capability.PatternAction, resource: string) =>
  new Permission.Rule({ effect: "allow", pattern: new Capability.CapabilityPattern({ action, resource }) })

export const guarded = HostServices.layer.pipe(
  Layer.provide(Layer.orDie(GrantStore.layer({ attended: false, rules: [allow("fs:read", "/workspace/**")] }))),
  Layer.provide(Workspace.layer("/workspace"))
)

export const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const readme = yield* fs.readFileString("/workspace/README.md")
  yield* fs.writeFileString("/workspace/out.txt", readme)
})
```

| Program | Tokens (o200k_base) | Lines |
| --- | --- | --- |
| Vibe, proposed | 70 | 7 |
| Smithers 1.x | 178 | 16 |

**Checked.** The Vibe example uses only existing syntax. It compiles under `vibelang` 0.0.13 against a declaration of the proposed `Experimental.Capability.guard`. The Smithers program type-checks as shown.

## Principles

- **TypeScript-first.** No syntax. A policy is an array of strings.
- **Effect-second.** The kernel is layers over Effect's own service tags. "Decorating in place is the point."
- **Optimized for agentic programs.** An agent runs tools a person did not write. A policy bounds them, and `attenuate` bounds a sub-agent further.
- **Highly forkable.** A fork changes the action list or the grant store in one package, with no compiler change.
- **Factory-first.** The factory's agents run under a published policy.

## What this changes

- `Experimental.Capability` is new. No grammar changes.
- The plan format gains two fields per task: tier and declared capabilities.
- `static readonly tier`, `capabilities` and `effects` are typed by this module.

## Alternatives

- **Effect tiers in the type system**, such as `string!E!R!Tier`. A fourth channel on every Effect type costs tokens on every signature, and a tier depends on the resource, which is a run-time value.
- **A `grant` block, `grant "fs:read:/workspace/**" { … }`.** It is `provide Experimental.Capability.guard(…) { … }` with a new keyword.
- **Capabilities as object references**, passed as arguments, as in an object-capability language. Vibe already passes authority that way: a service in the requirement type. The kernel refines it by resource.
- **Treat an unmatched request as denied.** A host can do that with one rule. The default keeps `ask`, the state an attended run needs.
- **Leave it to the operating system or a sandbox.** A sandbox bounds a whole process. A policy bounds one step and can ask a person.

## Follow-up questions

1. **A sealed project mode.** The kernel cannot see `.ts` code. Should a `vibe.config.json` flag refuse `.ts` and `module` code that reaches a platform API outside an allowlist? That is compiler work, and the one place this VIP could become a language VIP. Recommendation: decide with VIP-54, which owns platform code.
2. **Warn on a missing tier.** A task whose body needs `HttpClient` or `ChildProcessSpawner` and that declares no `tier` defaults to `sealed`, which claims its result is reproducible. Recommendation: a compiler warning.
3. **Exact grants.** The glob grammar cannot express a resource that holds `*` or `?`. Should the port add an exact matcher beside the globs? Recommendation: yes, before agents write grants.
4. **Smithers' `Jj` service.** It is guarded in Smithers because compensable steps snapshot the workspace with jj. Whether Vibe exposes `Jj` at all is [std-durable](0060-std-durable.md)'s question.

## Depends on

- [VIP-33](0033-platform-stdlib.md), accepted: platform access through injected services.
- Nothing in this set. `Capability.journaled` takes the journal as a requirement; [std-durable](0060-std-durable.md) provides it.
