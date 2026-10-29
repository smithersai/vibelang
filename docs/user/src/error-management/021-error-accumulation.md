# Error Accumulation

Independent checks often must report every problem in one response. Validation collects domain errors; partitioning also keeps successful results when other inputs fail.

[Upstream page](https://effect.website/docs/v4/error-management/error-accumulation)

## Validating every computation

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-13, VIP-14
// run: try Console.log(try validateHandle(" RIVER ")); try Console.log(JSON.stringify((try flip(validateTeam())).map((error) => error.input)))
error InvalidHandle {
  input: string
}

effect function validateHandle(input: string) {
  const handle = input.trim()
  if (handle.length < 3) throw new InvalidHandle({ input })
  return handle.toLowerCase()
}

effect function validateTeam() {
  return try validate(
    ["Jo", "RIVER", ""],
    (input) => validateHandle(input),
    { concurrency: 2 }
  )
}
// string[]![InvalidHandle, ...InvalidHandle[]]!
```

```output
river
["Jo",""]
```

`validate` runs each input's Effect even when others fail with typed errors. If any fail, the error channel holds a nonempty array of every domain error and the successes are discarded; otherwise it returns an array of successes.

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try checkTeamOnly(); try Console.log("All handles valid")
effect function checkTeamOnly() {
  try validate(["RIVER", "SKY"], (input) => validateHandle(input), {
    discard: true,
    concurrency: 2
  })
}
```

```output
All handles valid
```

`discard: true` returns `void` on success, when you only need validation. `concurrency` sets how many checks run at once. A cause without an expected failure still terminates the computation. These APIs use Effect's error-to-result conversion: a cause with a defect propagates, its expected failures as defects, and an expected failure beside an interruption shrinks to that error and loses the interruption; inspect the cause when it matters.

## Partitioning successes and failures

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(JSON.stringify(try inspectTeam()))
effect function inspectTeam() {
  const [handles, errors] = try partition(
    ["Jo", "RIVER", ""],
    (input) => validateHandle(input),
    { concurrency: 2 }
  )
  return {
    handles,                       // ["river"]
    rejected: errors.length        // 2
  }
}
// { handles: string[]; rejected: number }!!
// Output: {"handles":["river"],"rejected":2}
```

The tuple order is `[successes, failures]`. `partition` keeps both arrays and removes expected errors from `E`, so you can accept valid inputs and report rejected ones. Its mixed-cause policy matches validation's.

## Coming from Effect

Pass `validate` or `partition` a callback returning an Effect. A plain arrow can return an existing Effect; an effect arrow can run Effects that need services, pause, or have typed failures. A plain array `map` only collects the returned Effects; it does not run them.