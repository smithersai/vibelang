# Theorems, spec functions and proofs

```text
count.vibe                                     vibelang -p .
spec function countPrefix(…) {            ->  count.js    holds count only
  proof { assume …  ensures …  decreases … }  count.d.ts  holds count only
}
export function count(…) {                     vibelang prove
  proof { ensures(… countPrefix(…) …) }   ->  proofs/count.vibe.ts  //@ requires, //@ ensures …
  for (…) { proof { invariant … } … }          lsc regen --backend=dafny, then Dafny, then the audit
}                                              proved countPrefix, proved count, proved countBounded
theorem countBounded(…) { assume …  assert … }
```

A `theorem` states a fact about plain functions for every value of its parameters. A `spec function` exists for proofs only. A `proof { }` block states facts about a plain function at one point of its body: its leading block is the function's contract, and a loop's leading block holds the loop's invariants. All three are checked like plain code and erase: they compile to no JavaScript and no declarations, so a proof never changes what runs. `vibelang prove` checks the facts with [LemmaScript](https://github.com/midspiral/LemmaScript) and Dafny. The rules are in [Appendix F](../../../design/src/900-appendices.md#appendix-f-theorems-and-proofs-vip-43) of the specification.

## Theorems

```vibe
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

A theorem looks like a function without the `function` keyword and reads like a test, except that it holds for every input. `theorem` is a keyword only before a name and `(` or `<` on the same line; anywhere else it is an ordinary name.

| Part | Rule |
| --- | --- |
| Where | A statement of a `.vibe` or `.vibex` module's top level. It is never exported, and nothing references it. |
| Parameters | Each is a plain name with a type: no optional, rest, defaulted or destructured parameter, and no return type. Type parameters are allowed. |
| `assume(P)` | A hypothesis. Every `assume` comes first, as a direct statement of the body. |
| `assert(Q)` | A fact to prove. A theorem has one or more. |
| `const x = E` | Names an expression that a later statement uses. |
| `if (C) S`, `else`, `{ }` | An `if` around an `assert` is an implication, and `else` its negation. |

The expressions are verification expressions: names, literals, calls, member and element accesses, `!`, `-`, `*`, `+`, comparisons, `===`, `!==`, `&&`, `||`, `?:`, and `Math.floor(a / b)`. `xs.every((x) => P)` is "for every element" and `xs.some((x) => P)` is "for at least one". `%`, `/` outside `Math.floor`, fractions and `==` are not allowed, because the proofs treat `number` as an integer.

A function with a loop, a `let` or an assignment is a procedure: a proof sees its `ensures` contract and never its body. A function of a `.ts` or `.js` file is a procedure too. A theorem calls a procedure only in a `const` of its body:

```vibe
export function linearSearch(xs: readonly number[], target: number): number {
  proof {
    ensures((r) => r < xs.length)
    ensures((r) => r < 0 || xs[r] === target)
  }
  let i = 0
  while (i < xs.length) {
    proof {
      invariant(0 <= i && i <= xs.length)
      invariant(!xs.slice(0, i).includes(target))
      decreases(xs.length - i)
    }
    if (xs[i] === target) return i
    i += 1
  }
  return -1
}

theorem searchFinds(xs: readonly number[], target: number) {
  const index = linearSearch(xs, target)
  if (index >= 0) assert(xs[index] === target)
}
```

## Spec functions and proof blocks

A `spec function` is checked like a plain function, and only theorems, proof blocks and other spec functions may call it.

```vibe
spec function countPrefix(xs: readonly boolean[], end: number): number {
  proof {
    assume(0 <= end && end <= xs.length)
    ensures((r) => 0 <= r && r <= end)
    decreases(end)
  }
  if (end <= 0) return 0
  return countPrefix(xs, end - 1) + (xs[end - 1] ? 1 : 0)
}

export function count(xs: readonly boolean[]): number {
  proof {
    ensures((r) => r === countPrefix(xs, xs.length))
  }
  let total = 0
  for (let i = 0; i < xs.length; i++) {
    proof {
      invariant(0 <= i && i <= xs.length)
      invariant(total === countPrefix(xs, i))
      decreases(xs.length - i)
    }
    if (xs[i]) total++
  }
  return total
}
```

## Proof statements

| Statement | Where | Means |
| --- | --- | --- |
| `assume(P)` | a function's leading proof block | a precondition |
| `ensures((r) => Q)` | a function's leading proof block | `Q` holds for every value `r` the function returns; needs a written return type |
| `decreases(E)` | a function's or loop's leading proof block | the termination measure |
| `invariant(P)` | a `while`, `for` or `for … of` loop's leading proof block | holds before every iteration and after the last |
| `assert(Q)` | any proof block | a fact at that point |

A proof block may also hold `const` declarations, `if` statements and blocks. Outside theorems and proof blocks the five names are ordinary names, so a project's own `assert` keeps working. The editor checks postcondition arrows as proof expressions. A spec function has no loop, `let` or assignment, and calls no procedure: write it with expressions and recursion.

## Running the proofs

Install `lemmascript@0.6.6` as a development dependency and put Dafny 4.11.0 on `PATH`, then run `vibelang prove` in the project, or `vibelang prove -p <project>`:

```text
$ vibelang prove
proved  countPrefix  src/count.vibe:1
proved  count        src/count.vibe:11
2 proved, 0 not proved, 0 trusted.
Model: number is an unbounded integer: NaN, infinities, -0, fractions and the 2^53 limit are outside these proofs.
Verified by LemmaScript 0.6.6 (MIT, Midspiral, https://github.com/midspiral/LemmaScript) with Dafny 4.11.0.
```

A root is a theorem, a spec function or a plain function with a proof block, and `vibelang prove` reports each one as `proved` or `failed`. A function from a `.ts` file is trusted: proofs see its signature, never its body, and `vibelang prove --strict` refuses it. The proofs treat `number` as an unbounded integer, which the `Model:` line says on every run.

### The proof directory

`vibelang prove` writes the generated TypeScript and Dafny under `proofs/` beside the project's `tsconfig.json`. `vibe.proofDir` names another directory:

```json
{
  "vibe": { "proofDir": "verification/dafny" }
}
```

| Value | Directory |
| --- | --- |
| not set | `proofs` in the selected config's directory |
| a relative path | relative to the config that declares it, which matters under `extends` |
| a path that starts with `${configDir}` | relative to the selected config's directory |
| not a string | `EK3007` |

The directory belongs to `vibelang prove`: it holds no file of the program and no file the command did not write (`EK4316`). Commit `P.dfy` and `P.dfy.gen`. When Dafny needs help, add lemmas and `assert` steps to `P.dfy`; `lsc regen` merges them into each new generation.

### The audit

A passing Dafny run is not enough, so `vibelang prove` audits what LemmaScript generated for each module:

| Check | Fails when | Code |
| --- | --- | --- |
| Obligations | the generated Dafny for a function holds fewer or more `assert` statements and `ensures` clauses than the function states | `EK4317` |
| Classification | LemmaScript emits a Dafny `function` for a procedure, or a `method` for a function proofs may unfold | `EK4317` |
| Assumptions | `dafny audit` reports an assumption in `P.dfy` that `P.dfy.gen` does not hold, such as `{:axiom}` or `assume` | `EK4318` |

A module that fails the audit is not proved, whatever Dafny verified: a hand-written addition may prove a fact and never assume one.

## Diagnostics

| Code | Means |
| --- | --- |
| `EK4302` | `export`, `async`, `effect`, a generator or an overload on a theorem or spec function; or one below the module's top level |
| `EK4303` | a theorem parameter that is not `name: Type`, or a theorem return type |
| `EK4304` | a proof block outside a top-level plain function or spec function, or inside a theorem |
| `EK4305` | a theorem or proof block statement other than a proof statement, `const`, `if` or a block; an `assume` after another theorem statement; an unused `const`; a theorem with no `assert` |
| `EK4306` | a proof statement outside its place in the table above; `ensures`, `invariant` or `decreases` in a theorem |
| `EK4307` | `by`, or a second argument to `assert`: there are no proof tactics yet |
| `EK4308` | a call to a procedure in a proof expression, outside a `const` of a theorem body |
| `EK4309` | `ensures` without a written return type, or without `(r) => Q` |
| `EK4310` | a reference to a theorem, or running code that uses a spec function |
| `EK4311` | a proof expression outside the verification expression forms, such as `%`, `/`, a fraction or `==` |
| `EK4314` | a spec function with a loop, `let`, assignment or a call to a procedure |
| `EK4315` | Dafny could not prove an obligation |
| `EK4316` | LemmaScript or Dafny is missing or not the pinned release, or the proof directory holds other files |
| `EK4317` | LemmaScript rejected the generated file, or the audit found a lost obligation or a different classification |
| `EK4318` | a hand-written `P.dfy` changes a generated line or adds an assumption |
| `EK4319` | `--strict` and a trusted function from a `.ts` file |
