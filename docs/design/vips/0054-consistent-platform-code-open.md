# VIP-54: One consistent model for platform-specific code (open)

**Status:** open, 2026-11-09. Early proposal: recorded for discussion, not decided. No candidate model is selected, and this VIP changes no compiler behavior until accepted.

## Will's words

> It's very simple. Our way of handling platform specific stuf fis inconcistent and we need an actual consistent way of doing. Everything we are doing now is hacky ad hoc one off including that ruling

> Add as this as a new vibe proposal tha tis early that we generally want to figure out how to deal with this. We want vibelang to be as explicit as possible while still accepting syntax tha tm ay be platform specific and we need to figure out cleanest way to do this

> why is vibelang not accepting it? It should work the same as typescript

**One sentence.** One rule decides every platform-specific form in Vibe code (`import.meta` members, platform globals, build-tool transforms and host APIs), keeps each dependence explicit, and accepts what TypeScript accepts for the platforms a project targets.

**One paragraph.** Today VibeLang handles platform code through separate rules in [VIP-33](0033-platform-stdlib.md): its seven platform amendments of 2026-10-29 through 2026-11-07 cover banned globals, their derivation from library declarations, static accesses through `globalThis`, bare `Worker`, `import.meta.url`, platform members and members of an injected page. The later ruling, “Vibelang should allow it if it's using vite. Same as ts”, makes `import.meta` follow TypeScript; VIP-33's amendment records it, and the compiler implements it. These rules and that ruling are the ad hoc policies this proposal seeks to replace with one model. None is superseded while this VIP remains open.

## Existing rules to reconcile

The seven platform amendments are recorded in [VIP-33](0033-platform-stdlib.md), rather than in a separate decided-details log:

| Amendment | Existing policy to reconsider |
| --- | --- |
| Amended 2026-10-29: the banned globals | Node and web host globals are compile errors; pure data utilities remain allowed. |
| Amended 2026-10-29: the banned globals are derived, not listed | The restriction follows the resolved symbol's library declarations, including `lib.dom*`, `lib.webworker*` and `@types/node`, with a closed allowlist. |
| Amended 2026-10-29: `globalThis` and `import()` | `globalThis` is restricted to statically named member access; computed imports and literal `data:` or `blob:` imports have separate rules. |
| Amended 2026-10-29: bare `Worker` | Bare `Worker` resolves to Effect's namespace; host `Worker` bindings remain restricted. |
| Amended 2026-10-29: `import.meta` is limited to `import.meta.url` | Superseded by the TypeScript-parity amendment of 2026-11-09: members follow the program's `ImportMeta` declarations. |
| Amended 2026-10-30: one rule for platform members | Statically named members are classified by whether their resolved symbols reach the host. |
| Amended 2026-11-07: members of an injected page | Members reached through an injected value are distinguished from members reached through a host global. |

The later `import.meta` ruling is also within this proposal's scope. It is an interim policy to reconcile, not a model selected by VIP-54. The list concerns platform-access policy; unrelated VIP-33 guarantees are outside this proposal.

## The case that exposed it

```vibe
// A documentation site reads its Markdown pages at build time.
export const pages: Record<string, string> =
  import.meta.glob("../../factory/*.md", { query: "?raw", import: "default", eager: true })
```

```text
error EK4402: Only import.meta.url is available in a .vibe file; use the Path or Config service
for host state, or move this import.meta use to a .ts file.
```

The compiler reported this before the TypeScript-parity amendment. The TypeScript twin is accepted in a Vite project with the corresponding `ImportMeta` declarations. Vite replaces it with static imports at build time, as it does the `?raw` imports Vibe already accepts.

## Requirements to evaluate

These are goals for the proposed model, not changes to the accepted language.

- **One rule.** The same mechanism decides `import.meta.*`, `process`, `Buffer`, `window`, `Deno`, `Bun`, Worker bindings, `?raw` and other build-tool imports, and any future platform. No per-member exceptions.
- **Explicit.** A reader, a reviewer or an agent can tell, from the source or from one declared place, which code depends on which platform or tool.
- **Accepting.** Code TypeScript accepts for a platform the project declares is not an error in Vibe.
- **TypeScript-first.** Use TypeScript's own mechanisms (types, `ImportMeta` and global augmentation, `tsconfig.json` `types` and `lib`) before adding syntax.
- **Replaces, not adds.** On acceptance, the selected model replaces the platform-access policies listed above, including the later `import.meta` ruling, and the specification cites the consistent model rather than accumulating exceptions.

## Candidate models (to design and compare; none decided)

1. **TypeScript's behavior.** Everything type-checks as in TypeScript. Host access is a lint finding ([VIP-38](0038-effect-lint-built-in.md)) that points to the Effect service, never a compile error.
2. **Declared by types.** A platform form is valid exactly when the project's declared types provide it (`"types": ["vite/client"]`, `"types": ["node"]`, `"lib": ["dom"]`). The `tsconfig.json` is the one explicit place.
3. **Declared per module.** Each module states its platform (an import attribute, a directive or a `host` declaration), and only that module may use that platform's forms.
4. **Build time versus run time.** Build-time transforms are accepted. Run-time host reads go through Effect services, by one rule that classifies every form.

## Open questions

- Which model, or which combination, meets all five requirements?
- How does an agent learn which platforms a project allows?
- What do emitted declarations show `tsc` users?
- What is the migration for code written under VIP-33's amendments?

## What this changes

Nothing until accepted. Acceptance would select the consistent model, reconcile and supersede the platform-access amendments listed above and the later `import.meta` ruling, and update VIP-33 and the affected specification chapters together. This open proposal neither accepts a model nor repeals any existing rule.
