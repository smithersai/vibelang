# W1-F Runtime API Report

## API audit

No required method names were missing, so no duplicate API methods were added.

- Result methods already present: `isOk`, `isError`, `match`, `map`, `mapError`, `andThen`, `recover`, `tap`, `tapError`, `unwrap`, `unwrapOr`, `expect`, `Result.all`, `Result.try`, and `Result.tryPromise`.
- Optional methods already present: `isSome`, `isNone`, `match`, `map`, `andThen`, `filter`, `tap`, `unwrap`, `unwrapOr`, `toResult`, `toNullable`, `Optional.fromNullable`, and `Optional.all`.
- Error prototype helpers already present: `is`, `matches`, `match`, `matchPartial`, and `rootCause`.

The audit found and corrected one required semantic gap in `Result.recover`: a branded `Panic` now passes through unchanged without invoking the ordinary recovery callback. The return type retains the possible `Panic`, and `Panic` now has a compile-time nominal brand matching its existing runtime `WeakSet` brand. Result and Optional runtime variants remain frozen and `WeakMap`/`WeakSet` branded.

`Optional.toResult` supports both the normative error-value form (`toResult(error)`) and the cheap zero-argument thunk form (`toResult(() => error)`). The thunk is lazy and is not called for a present Optional.

No wire codec changes were required; strict canonical encoding/decoding remains unchanged.

## Must-use consumer names for coordinator

No new consumer names are required because no method names were added. The complete receiver lists to retain/check are:

- Result: `isOk`, `isError`, `match`, `map`, `mapError`, `andThen`, `recover`, `tap`, `tapError`, `unwrap`, `unwrapOr`, `expect`.
- Optional: `isSome`, `isNone`, `match`, `map`, `andThen`, `filter`, `tap`, `unwrap`, `unwrapOr`, `toResult`, `toNullable`.
- Collection consumers: `Result.all` consumes its Result inputs and returns a new must-use Result; `Optional.all` consumes its Optional inputs and returns an Optional.

## Tests and verification

- Added 4 adversarial runtime tests and 90 assertions, including inactive-branch traps, malformed handler/chained values, first-failure/absence short-circuiting, lazy fallbacks, both `toResult` forms, adapter success paths, and Panic-preserving recovery.
- `bun run check`: passed.
- `bun test src/runtime/runtime.test.ts`: 19 passed, 0 failed, 190 assertions.
- `bun test src/concurrency/concurrency.test.ts`: 7 passed, 0 failed, 21 assertions.
- Combined requested tests: 26 passed, 0 failed, 211 assertions.

SOURCE SETTLED
