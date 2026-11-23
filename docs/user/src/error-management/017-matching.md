# Matching

`Effect.match`, `matchEffect`, `matchCause`, and `matchCauseEffect` fold an Effect's success and failure outcomes into one value or next branch. Use typed matching for domain errors, and cause matching at boundaries that must inspect defects or interruption.

[Upstream page](https://effect.website/docs/v4/error-management/matching)

| Combinator | Handles | Callbacks | Resulting `E` |
| --- | --- | --- | --- |
| `Effect.match` | Success and typed `E` | Plain synchronous functions | `never` |
| `matchEffect` | Success and typed `E` | Effectful functions | Union of branch errors |
| `matchCause` | Success and full `Cause<E>` | Plain synchronous functions | `never` |
| `matchCauseEffect` | Success and full `Cause<E>` | Effectful functions | Union of branch errors |
| `ignore` | Discards success and typed `E` | None | `never` |
| `ignoreCause` | Discards success and full `Cause<E>` | None | `never` |

## Folding success and failure into values

```vibe
// run: try Console.log(try countLabel(3)); try Console.log(try countLabel(-1))
error InvalidCount

effect function itemCount(raw: number) {
  if (raw < 0) throw new InvalidCount()
  return raw
}

effect function countLabel(raw: number) {
  return try Effect.match(itemCount(raw), {
    onFailure: () => "Count unavailable",
    onSuccess: (count) => `${count} items`
  })
}
// string!!
```

```output
3 items
Count unavailable
```

`Effect.match` runs synchronous callbacks that return plain values and cannot execute Effects. Causes with no expected failure propagate unchanged, and causes containing a defect propagate with their expected failures promoted to defects. When an expected failure occurs alongside an interruption, Effect selects the expected failure and drops the interruption, matching ordinary `catch`.

## Choosing effectful branches

```vibe
// run: try Console.log(try reportCount(3)); try Console.log(try reportCount(-1))
effect function reportCount(raw: number) {
  return try matchEffect(itemCount(raw), {
    onFailure: effect () => {
      try Console.log("Invalid count received")
      return "Count unavailable"
    },
    onSuccess: effect (count) => {
      try Console.log("Count accepted")
      return `${count} items`
    }
  })
}
```

```output
Count accepted
3 items
Invalid count received
Count unavailable
```

`matchEffect` runs only the selected branch, and that branch's errors and service requirements join the returned Effect's type. Prefer a `catch` expression with an effect handler when recovery needs several statements and the success path needs no transformation.

## Matching complete failure causes

```vibe
// run: try Console.log(try outcomeLabel()); try Console.log(try reportOutcome())
effect function outcomeLabel() {
  return try matchCause(die(new Error("index invariant")), {
    onFailure: (cause) => Cause.hasDies(cause) ? "Index defect" : "Index stopped",
    onSuccess: () => "Index ready"
  })
}

effect function reportOutcome() {
  return try matchCauseEffect(die(new Error("index invariant")), {
    onFailure: effect (cause) => {
      try Console.log("Index stopped", try Effect.try(() => JSON.stringify(cause.reasons.map((reason) => reason._tag))))
      return "Unavailable"
    },
    onSuccess: () => succeed("Ready")
  })
}
```

```output
Index defect
Index stopped ["Die"]
Unavailable
```

`matchCause` passes the full `Cause` to a synchronous failure callback; `matchCauseEffect` allows Effects in both branches. Because both consume defects, interruption, and mixed causes, restrict them to boundaries whose policy explicitly owns those outcomes.

## Discarding failures or all causes

```vibe
// run: try ignoreRejectedCount(); try discardBoundaryOutcome()
effect function ignoreRejectedCount() {
  try ignore(itemCount(-2))
}
// void!!

effect function discardBoundaryOutcome() {
  try ignoreCause(die(new Error("isolated task failed")))
}
// Output:
```

`ignore` discards both the success value and typed failures while keeping the same mixed-cause rules as `Effect.match`: causes without an expected failure propagate, causes with a defect propagate, and an expected failure paired with an interruption is consumed together with it. `ignoreCause` swallows every cause—including defects and interruption—so use it only when suppressing both diagnostics and cancellation is intentional.
