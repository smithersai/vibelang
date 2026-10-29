# Writing the VibeLang user docs

These docs mirror the Effect 4 documentation page for page: same sections, order and topics (see `inventory.md`). Every page is original writing about VibeLang. Read the upstream page to learn what it covers; never copy its prose or code (see `ATTRIBUTION.md`).

## Sources of truth

1. The accepted VIPs in `docs/design/vips/` win every conflict. Nothing is part of the language unless a VIP adds it.
2. `docs/design/src/`, the spec, rewritten from the VIPs, one file per chapter. Chapter numbers change; refer to topics.
3. `docs/design/history/`, the previous specification and its decision log (`DECISIONS.md`). They are historical, not normative, but they still describe the compiler where it hasn't caught up with the VIPs: read the historical tooling chapter (`docs/design/history/src/428-part4-ch28-tooling.md`) for exact tool names and diagnostic codes, and cite only codes the compiler's registry defines (D53).
4. Effect 4.0.6's API, in `experiments/node_modules/effect/src`. Check every Effect name you use there.

## The language

Read the VibeLang skill, `packages/compiler/skills/vibelang/SKILL.md`: every form, rule and idiom on one page, current through the newest decision. Where a page disagrees with it or with the decision log, the page changes. Writers most often get these wrong; the decisions own the details:

- Calls run; a call returning anything but `Effect` itself returns data, such as a `Config`, an `Exit`, a key or an error (D24). A parameter that expects a program takes a call by name (D147), and collections of programs convert (D49).
- A service is a `service` declaration with bodiless members (D128, D223): `Users.find(id)` adds `Users` to R and `Users()` returns the implementation (D41). A layer is `Layer.effect(Users) { ... }` or `Layer.succeed(Users, { ... })` (D221), not a service class.
- `catch` receives expected failures only, the first of several (D13, D28); defects, such as `Option.getOrThrow`'s, pass through, and a catch whose try block has E = `never` warns EK2004 (D260); a plain function's catch follows the same rule, and a throw is a typed failure everywhere outside a hatch, so a plain-annotated function never fails (D282).
- Effect's root exports and its subpath packages' modules need no import (D146, D310); `Scope` is in the prelude (D48).
- Effect's own packages are trusted, so their throws are defects (D22); other TypeScript is trusted by `trustedPackages` or `trusted(impl, [Errors])` (D261, D249), or called through a hatch.
- Runners run only where no fiber runs the code (D38); `.vibe` tests use `it.effect` or `it.live`, and Promise-style tests stay in `.ts`.
- A producer is a `Stream` wherever one is expected, and `for...of` over a `Stream` pulls and closes it (D26).
- Settings go in a top-level `vibelang` object in `tsconfig.json` (D275). dprint formats and ESLint lints `.vibe` files (D276, D277).
- Effect code in TypeScript's style draws warnings EK4830-EK4837 whose quick fixes write the VibeLang form (D284-D290), and `vibelang --fix` applies them (D291). Serializable errors use `Schema.TaggedError`, which draws EK4837 without a fix: an error declaration would drop its Schema, so the class stays where the Schema is needed.
- A hatch example must show something VibeLang cannot write directly: a Promise or callback API, a foreign library call, or platform code. Write ordinary computation in plain VibeLang. Network examples are compile-checked; never mark them `// run:`.

## Voice

- Write for a developer learning VibeLang. Serve readers who know Effect with a short "Coming from Effect" section at a page's end, not a comparison on every line.
- Plain, concrete, active sentences. Code first, then the explanation. Short paragraphs.
- No em dashes or en dashes, no hedging ("might", "could potentially"), no marketing words.

## Page template

```md
# Page title

One paragraph: what this is and when you use it.

## A section per topic in the stub's topic list

Example first, then two to five sentences.

## Coming from Effect        (optional)

- `Effect.gen(function* () { … })` becomes an ordinary function.
```

VibeLang code uses the `vibe` fence. Real TypeScript uses the `ts` fence and starts with `// TypeScript (.ts)`; Effect TypeScript shown for comparison uses `ts effect`. Name a file in a first-line comment when it matters (`// main.vibe`, `// vite.config.ts`); its extension matches the fence. After a function, show the inferred contract as a comment when it teaches something: `// User!UserNotFound!Users`.

## Tested output

Show exact stdout with an `output` fence immediately after a runnable `vibe` or checked `ts` block (blank lines between are allowed), or with one `// Output: text` line per stdout line inside the block; an empty `// Output:` asserts no stdout. Don't combine the two forms. `out` and `text` fences are display-only.

`bun docs/tools/check-snippets.ts --run` runs these examples. Export `function main()` or include a top-level runner to make a block an entry module. For a function excerpt, add a header comment such as `// run: Console.log(greet("Ada"))`: the checker runs that expression in a VibeLang entry function with the excerpt's declarations in scope. Use `Console.log` for stable output. Match spaces and line order exactly; only line endings and one final newline are normalized. Marked `@effect/vitest` examples run in Vitest, where an empty output marker checks that their assertions pass silently. Keep examples deterministic and under ten seconds. See [the checker conventions](../tools/README.md#running-examples).

## Pages about APIs that do not change

Many modules work exactly as in Effect: `Option`, `Chunk`, `HashMap`, `Duration`, `DateTime`, `BigDecimal`, `Equal`, `Hash`, `Order`, `Schedule`, most of `Schema`, and more. Say so in the first paragraph ("`Duration` works in VibeLang exactly as in Effect.") and show VibeLang usage, where building a value is a plain call and only Effect-returning functions run.

## When the spec has no answer

Write the answer most consistent with the rules above, and mark it with a block quote: `> **Proposed.** …`. If no consistent answer exists, write `> **Not designed yet.** <the precise question>`. Record unresolved questions with the page path in the issue or review. Keep drafting and process history outside the public source tree.

## Token counts

`vibelang-features/117-token-counts.md` publishes each page's token count. After changing any page, the skill or the decision log, run `bun docs/tools/token-counts.ts --write`; `--check` fails until you do.
