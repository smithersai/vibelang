# VIP-43: `theorem` and `spec`, proofs in TypeScript's own syntax (open)

**Status:** open, 2026-11-06. Proposed by Will. Listed for a decision; nothing is implemented.

**One sentence.** `theorem` declares a fact about VibeLang code in ordinary TypeScript-shaped syntax, the compiler erases it from emitted code, and `vibelang` proves it by lowering to LemmaScript's annotated TypeScript and running LemmaScript's compiler.

**One paragraph.** VibeLang's plain functions are close to the pure, functional TypeScript that LemmaScript can verify. LemmaScript writes specifications as `//@` comments. This VIP gives VibeLang first-class syntax for the same ideas: a theorem looks like a function and reads like a test, except it holds for every input. Only `theorem`, `spec` and `proof` are new words. Inside them, proof statements read as calls that existing tools can parse. All of it erases, so a proof never changes what runs. VibeLang does not reimplement verification: it generates LemmaScript's input and uses LemmaScript's compiler, Dafny and Lean.

## Decision

```ts
// proposed
export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo
  if (x > hi) return hi
  return x
}

theorem clampInRange(x: number, lo: number, hi: number) {
  assume(lo <= hi)
  const result = clamp(x, lo, hi)
  assert(lo <= result && result <= hi)
}
```

`assume` states a hypothesis. `assert` states what must be proved, with no `\result`, because the fact is about a call you can name. An `if` around an `assert` is implication.

```ts
// proposed
theorem sumNonNegative(xs: readonly number[]) {
  assume(xs.every((x) => x >= 0))
  assert(sum(xs) >= 0, by.induction(xs))
}

theorem searchFinds(xs: readonly number[], target: number) {
  const index = linearSearch(xs, target)
  if (index >= 0) assert(xs[index] === target)
}
```

`xs.every` is the universal quantifier and `xs.some` the existential one. The optional second argument of `assert` names a proof tactic, in the place a message usually goes.

Facts about a point in running code go in a `proof { }` block at that point:

```ts
// proposed
function linearSearch(xs: readonly number[], target: number): number {
  let i = 0
  while (i < xs.length) {
    proof {
      invariant(0 <= i && i <= xs.length)
      invariant(xs.slice(0, i).every((x) => x !== target))
      decreases(xs.length - i)
    }
    if (xs[i] === target) return i
    i += 1
  }
  return -1
}
```

Proof-only code and trusted code use familiar words:

```ts
// proposed
spec function isSorted(xs: readonly number[]): boolean {   // proofs only, erased
  return xs.every((x, i) => i === 0 || xs[i - 1] <= x)
}

declare function matchesPattern(text: string, pattern: string): boolean   // trusted, not proved
```

## Rules

- `theorem`, `spec` and `proof` are contextual keywords, like `effect`. The name, `function` or `{` follows on the same line, so existing identifiers keep working.
- `proof { }` is a block inside running code. It holds proof statements and erases entirely. A `theorem` body is a proof context without one.
- `assume`, `assert`, `invariant`, `decreases` and `by` are valid only in a proof context: a `proof { }` block, a `theorem` or a `spec function`. Anywhere else they are ordinary names, so a project's own `assert` keeps working.
- A proof context runs nothing. It emits no JavaScript and no declarations, so VIP-31's runtime guarantees are untouched.
- Theorems cover plain functions only. An `effect` function can't be stated in a theorem yet, because LemmaScript verifies a pure functional subset and doesn't support `await`.

## Reusing LemmaScript

[LemmaScript](https://github.com/midspiral/LemmaScript), by [Midspiral](https://github.com/midspiral), is an MIT-licensed verification toolchain for TypeScript. This VIP stands on its work. VibeLang credits the project in its documentation and in the output of its proof command.

| What we use | What it does |
| --- | --- |
| The `lemmascript` npm package and its `lsc` CLI | Compiles annotated TypeScript to Dafny and Lean, and runs the check |
| Its `//@` annotation language | The input format VibeLang generates |
| Its specification of the verified TypeScript subset | Defines which code can be proved |
| Dafny, and Lean 4 with Velvet and Loom, through LemmaScript | The provers that check the proofs |
| Its split of generated files and hand-written proofs | Where manual proof work lives |

VibeLang owns only the syntax, its checks and the lowering. LemmaScript stays an optional development dependency, installed by a project that uses `theorem`, and never a runtime dependency.

### Compile to its comments

`vibelang` lowers a `.vibe` file to TypeScript with `//@` comments, in a generated file, and runs `lsc`:

| VibeLang | LemmaScript |
| --- | --- |
| `theorem name(args) { ... }` | A generated function with `//@ verify` |
| `proof { ... }` | Its statements, as `//@` comments at that point |
| `assume(P)` | `//@ requires P` |
| `assert(Q)` | `//@ assert Q` |
| `invariant(P)` | `//@ invariant P` |
| `decreases(E)` | `//@ decreases E` |
| `spec function` | `//@ ghost` |
| `declare function` | `//@ extern` |

```ts
// generated from clampInRange
export function clampInRange(x: number, lo: number, hi: number): boolean {
  //@ verify
  //@ requires lo <= hi
  const result = clamp(x, lo, hi)
  //@ assert lo <= result && result <= hi
  return true
}
```

This is the simplest route. The comment language is LemmaScript's documented public interface. It ships as a CLI with no library entry point, so calling its internal IR would mean forking a tech preview and tracking its changes. Comments need no fork, and improvements in LemmaScript arrive with a version bump. If its package later offers a stable IR API, the lowering can target that without changing this syntax.

**Verified:** `lsc gen --backend=dafny` from `lemmascript` 0.6.1 compiled the hand-written form above and `linearSearch` to Dafny, keeping the `requires`, `assert`, `invariant` and `decreases`. In selective mode it left out `clamp`, which had no `//@ verify`, so the lowering must also mark every function a theorem reaches. No prover was installed, so nothing has been proved yet.

## Alternatives

- **Write `//@` comments in `.vibe`.** No compiler work, but specifications stay invisible to the type checker, and a typo is a comment.
- **Vendor the IR and emitters.** More direct, but VibeLang would own a verifier. Rejected until a stable API exists.
- **Lean-style `theorem name(...): P := by tactic`.** Faithful to Lean, but it reads as a foreign language inside TypeScript. Will rejected it.

## Open questions

1. How `by` lowers. `//@ assert` has no tactic argument, so tactics need a route to LemmaScript's proof files. Without one, `by` waits, and automation or hand-written proof files do the work.
2. Whether theorems live beside their functions or in a `.proof.vibe` file.
3. How source locations map back, so a failed proof points at the `.vibe` line.
4. The trust boundary. A proof covers LemmaScript's translation of the generated TypeScript, and VibeLang's lowering adds a step to that.
5. Which backend is the default. LemmaScript's design calls Dafny its primary backend.
6. The command name, and diagnostic codes, which VIP-34 assigns.
