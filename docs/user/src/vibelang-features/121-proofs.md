# Spec functions and proofs

```text
count.vibe                                     vibelang -p .
spec function countPrefix(…) {            ->  count.js    holds count only
  proof { assume …  ensures …  decreases … }  count.d.ts  holds count only
}
export function count(…) {                     vibelang prove
  proof { ensures(… countPrefix(…) …) }   ->  proofs/count.vibe.ts  //@ requires, //@ ensures …
  for (…) { proof { invariant … } … }          lsc regen --backend=dafny, then Dafny
}                                              proved countPrefix, proved count
```

A `spec function` exists for proofs only. It is checked like a plain function, compiles to no JavaScript and no declarations, and only proof blocks and other spec functions may call it. A `proof { }` block states facts about a plain function at one point of its body: its leading block is the function's contract, and a loop's leading block holds the loop's invariants. Proof blocks erase too, so a proof never changes what runs. `vibelang prove` checks the facts with [LemmaScript](https://github.com/midspiral/LemmaScript) and Dafny. The rules are in [Appendix F](../../../design/src/900-appendices.md#appendix-f-theorems-and-proofs-vip-43) of the specification; `theorem` declarations are not implemented yet.

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

A proof block may also hold `const` declarations, `if` statements and blocks. Outside proof blocks the five names are ordinary names, so a project's own `assert` keeps working. A spec function has no loop, `let` or assignment: write it with expressions and recursion.

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

It writes the generated TypeScript and Dafny under `proofs/` beside the project's `tsconfig.json`; commit `P.dfy` and `P.dfy.gen`. A function from a `.ts` file is trusted: proofs see its signature, never its body, and `vibelang prove --strict` refuses it. The proofs treat `number` as an unbounded integer, which the `Model:` line says on every run.

## Diagnostics

| Code | Means |
| --- | --- |
| `EK4302` | `export`, `async`, `effect`, a generator or an overload on a spec function |
| `EK4304` | a proof block outside a top-level plain function or spec function |
| `EK4305` | a proof block statement other than a proof statement, `const`, `if` or a block |
| `EK4306` | a proof statement outside its place in the table above |
| `EK4307` | `by`, or a second argument to `assert`: there are no proof tactics yet |
| `EK4309` | `ensures` without a written return type, or without `(r) => Q` |
| `EK4310` | running code uses a spec function |
| `EK4314` | a spec function with a loop, `let`, assignment or a call to a procedure |
| `EK4315` | Dafny could not prove an obligation |
| `EK4316` | LemmaScript or Dafny is missing or not the pinned release, or `proofs/` holds other files |
| `EK4317` | LemmaScript rejected the generated file |
| `EK4318` | a hand-written `P.dfy` changes a generated line |
| `EK4319` | `--strict` and a trusted function from a `.ts` file |
