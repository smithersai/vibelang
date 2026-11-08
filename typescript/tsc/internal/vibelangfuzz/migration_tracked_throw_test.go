package vibelangfuzz

import (
	"strings"
	"testing"
)

const migrationTrackedThrowTarget = "FuzzMigrationTrackedThrow"
const migrationTrackedThrowQuote = "| `JSON.parse(s)` | `SyntaxError` | `try Effect.try(() => JSON.parse(s))` |"

// An exception in a generator is a defect in Effect TypeScript, and adds
// nothing to E. Effect code tracks JSON.parse's and TextDecoder's, so --fix wrote
// a typed failure: a catch ran where none did, and the Effect's type changed,
// TS2375 against a written contract (Smithers' Route). The oracle compares the
// fixed module with the same source as .ts: outcome, and a catch in the .ts
// never running.
var migrationTrackedThrowPrograms = []struct{ key, source string }{
	{"parse-bad", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"{\") as number\n})\n"},
	{"parse-good", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"1\") as number\n})\n"},
	{"parse-contract", "export const main = (): Effect.Effect<number> => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"1\") as number\n})\n"},
	{"parse-member", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"[1,2]\").length as number\n})\n"},
	{"parse-statement", "export const main = () => Effect.gen(function* () {\n  JSON.parse(\"{\")\n  return 1\n})\n"},
	{"parse-in-catch", "export const main = () => Effect.catch(Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"{\") as number\n}), () => Effect.succeed(0))\n"},
	{"parse-ran-after", "export const main = () => Effect.gen(function* () {\n  const n = yield* Effect.succeed(\"1\")\n  return [n, JSON.parse(n) as number]\n})\n"},
	{"decode-uri", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return decodeURIComponent(\"%\")\n})\n"},
	{"bigint", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return String(BigInt(\"x\"))\n})\n"},
	{"text-decoder", "export const main = (): Effect.Effect<string> => Effect.gen(function* () {\n  yield* Effect.void\n  return new TextDecoder().decode(new Uint8Array(0))\n})\n"},
	{"boundary", "export const main = () => Effect.gen(function* () {\n  return yield* Effect.try(() => JSON.parse(\"{\") as number)\n})\n"},
	{"plain-callback", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return [\"1\"].map((s) => s + \"!\")\n})\n"},
}

func TestMigrationTrackedThrowQuoted(t *testing.T) {
	if chapter := SpecText("003-failures.md"); !strings.Contains(chapter, migrationTrackedThrowQuote) {
		t.Fatalf("Chapter 3 no longer says %q", migrationTrackedThrowQuote)
	}
}
