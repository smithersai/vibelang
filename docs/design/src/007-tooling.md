# Configuration and tooling

Sources: [VIP-30](../vips/0030-config-files.md), [VIP-32](../vips/0032-effect-version.md), [VIP-34](../vips/0034-compiler-and-tooling.md), [VIP-38](../vips/0038-effect-lint-built-in.md). Declaration output (VIP-27) is in [Functions](001-functions.md#declaration-output).

## Config files

In a directory, VibeLang reads the first of these that exists:

1. `vibe.config.json`
2. `tsconfig.json`
3. `jsconfig.json`

`vibe.config.json` is a strict superset of `tsconfig.json`. Every tsconfig field means the same there, `extends` included. The only addition is a top-level `"vibe"` section, which holds VibeLang's options in any of the three files. Plain `tsc` rejects unknown `compilerOptions` (TS5023) but ignores unknown top-level keys, so a repository's own TypeScript tooling keeps working.

```json
{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true }, "vibe": { "effectGlobals": false } }
```

The `"vibe"` section holds:

- the switch that turns off Effect's function globals ([VIP-6](../vips/0006-effect-globals.md));
- the switch that turns off Effect's modules in scope ([VIP-14](../vips/0014-effect-modules-in-scope.md));
- warning severities (VIP-34). Errors can't be turned off.

**Undecided (pending VIP):** the names and value shapes of these options. VIP-30 says they are settled during implementation; `effectGlobals` above is VIP-30's example, not a decided name.

## The Effect version

During alpha, VibeLang pins exactly one Effect version, and the pin moves to each new Effect release. The pinned dependency artifact is `effect@4.1.0`, and 4.1 is the earliest supported version (VIP-32, amended). Every Effect TypeScript mapping in this specification, and the `Exit` guarantee of [Runtime guarantees](008-runtime.md), is relative to the pin. The pin controls variables during alpha; it is not the long-term plan, and supported version ranges get their own VIP after alpha.

A migration upgrades the target repository to the pinned Effect first, on its own: it fixes what breaks and lands that commit with green tests. Only then does it convert files to `.vibe`, so each breakage shows its real cause. A repository that already uses VibeLang upgrades Effect together with the VibeLang release pinned to the new Effect, because the published `vibelang-runtime` enforces its exact pin.

## Compiler and tooling requirements

1. **Diagnostics.** Every diagnostic has a code (`EKxxxx`) and a message in the user's words that says what is wrong and how to fix it, with a quick fix wherever the fix is mechanical. [Appendix B](900-appendices.md#appendix-b-diagnostics) lists the codes.
2. **Codemods.** Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically.
3. **One formatter.** VibeLang's formatter is the only formatter. Prettier, dprint and Oxfmt reach it through plugins, so a repository's existing formatter command covers `.vibe` files.
4. **Existing tools work.** Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`. Every tool is tested against the dogfood repositories.
5. **Severities.** Warning severities can be adjusted in the `"vibe"` section. Errors can't be turned off.

## Effect's type-aware lint

The Effect language service's type-aware rules (effect-tsgo's `effecttsgo/*` rules) run inside the `vibelang` compiler on `.vibe` files. They run wherever VibeLang reports diagnostics: the CLI, the language server, and a lint command for CI. A repository's existing Effect language-service configuration selects and configures them, so its lint script covers `.vibe` as it covers `.ts`.

Tools that only analyze code, such as cycle checkers (madge) and dependency graphs, may run on VibeLang's compiled output. Formatters can't; they read `.vibe` itself.

**Undecided (pending VIP):** the name and options of the lint command.

## Schema library maintenance

**TODO ([VIP-15](../vips/0015-schema-declarations.md)):** create a Smithers generation script that updates the library when schemas change.
