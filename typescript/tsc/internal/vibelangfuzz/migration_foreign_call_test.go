package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationForeignCallTarget = "FuzzMigrationForeignCallPositions"

// Chapter 3 says how effect code calls a function that may throw.
const migrationForeignCallQuote = "Wrap it: `try Effect.try(() => parse(s))`"

const migrationForeignCallHelpers = `import * as Effect from "effect/Effect"
export const one = (): Effect.Effect<number> => Effect.succeed(1)
export const double = (n: number): number => n * 2
export const refuse = (n: number): number => {
  if (n < 0) throw new RangeError("negative")
  return n
}
export const pair = (a: number, b: number): readonly [number, number] => [a, b]
export const counter = { next: (n: number): number => n + 1 }
`

// The positions a call can stand in, in the body of an Effect.gen. CALL is the
// call. Smithers supplies the const, the template's substitution and the
// receiver; the rest finish the neighbourhood.
func migrationForeignCallPositions() map[string]string {
	return map[string]string{
		"const":          "const v = CALL\n  return v",
		"let":            "let v = 0\n  v = CALL\n  return v",
		"return":         "return CALL",
		"statement":      "CALL\n  return 0",
		"operand":        "return 1 + CALL",
		"negated":        "return -CALL",
		"second-const":   "const a = yield* one(), b = CALL\n  return a + b",
		"template":       "return `v=${CALL}`",
		"tagged":         "return yield* tag`v=${CALL}`",
		"argument":       "return yield* Effect.succeed(CALL)",
		"object":         "return { v: CALL }",
		"array":          "return [CALL]",
		"spread":         "return [...[CALL]]",
		"parenthesized":  "return (CALL)",
		"as":             "return (CALL) as number",
		"ternary-test":   "return CALL > 0 ? 1 : 2",
		"ternary-branch": "return n > 0 ? CALL : 0",
		"and":            "return n > 0 && CALL > 0",
		"coalesce":       "return (n as number | undefined) ?? CALL",
		"guard-ternary":  "return o.p ? CALL : 0",
		"guard-nested":   "return o.p ? CALL : n > 0 ? double(n) : double(0)",
		"guard-and":      "return o.p !== undefined && CALL > 0",
		"guard-if":       "if (o.p) {\n    const v = CALL\n    return v\n  }\n  return 0",
		"guard-early":    "if (!o.p) return 0\n  return CALL",
		"guard-unbraced": "if (o.p) CALL\n  return 0",
		"guard-line":     "if (o.p) { CALL }\n  return 0",
		"guard-else":     "if (!o.p) return 0\n  else CALL\n  return 1",
		"guard-else-if":  "if (n > 1) return n\n  else if (o.p) return CALL\n  return 0",
		"if-test":        "if (CALL > 0) return 1\n  return 2",
		"if-branch":      "if (n > 0) {\n    return CALL\n  }\n  return 2",
		"if-unbraced":    "if (n > 0) return CALL\n  return 2",
		"switch-test":    "switch (CALL) {\n    case 0: return 1\n    default: return 2\n  }",
		"while-test":     "let i = 0\n  while (CALL < 0 && i < 2) i++\n  return i",
		"for-test":       "let t = 0\n  for (let i = 0; i < CALL && i < 2; i++) t++\n  return t",
		"for-of":         "let t = 0\n  for (const k of [CALL]) t += k\n  return t",
		"for-body":       "let t = 0\n  for (const k of [1, 2]) {\n    t += k + CALL\n  }\n  return t",
		"callback":       "return [1].map((k) => k + CALL)",
		"nested":         "return double(CALL)",
		"receiver":       "return pair(CALL, 2)[0]",
	}
}

// The calls: each kind of callee, and operands that run or hold an Effect.
func migrationForeignCallCalls() map[string]string {
	return map[string]string{
		"name":      "double(n)",
		"namespace": "Helpers.double(n)",
		"method":    "counter.next(n)",
		"throws":    "refuse(n)",
		"narrowed":  "double(o.p)",
		"running":   "double(yield* one())",
		"two":       "pair(yield* one(), yield* one())[0]",
	}
}

const migrationForeignCallPrefix = `import * as Effect from "effect/Effect"
import * as Helpers from "./helpers.js"
import { counter, double, one, pair, refuse } from "./helpers.js"
const tag = (parts: TemplateStringsArray, ...values: ReadonlyArray<number>): Effect.Effect<string> =>
  Effect.succeed(parts.join("?") + values.join(","))
`

// migrationForeignCallSource returns the module in Effect TypeScript, and the
// same module in the effect code --fix meets once its generators are written.
func migrationForeignCallSource(position, call string) (typescript, vibe string) {
	body := strings.ReplaceAll(migrationForeignCallPositions()[position], "CALL", migrationForeignCallCalls()[call])
	typescript = migrationForeignCallPrefix + "export const value = (n: number, o: { readonly p?: number } = {}) =>\n  Effect.gen(function* () {\n  " + body + "\n  })\n"
	vibe = migrationForeignCallPrefix + "export const value = effect (n: number, o: { readonly p?: number } = {}) => {\n  " + strings.ReplaceAll(body, "yield*", "try") + "\n}\n"
	return typescript, vibe
}

// Chapter 900: EK4401 diagnostic - spec-rule: docs/design/src/900-appendices.md#9fa88f2d8563bd32
func TestMigrationForeignCallQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), migrationForeignCallQuote) {
		t.Fatalf("Chapter 3 no longer says %q; update the oracle", migrationForeignCallQuote)
	}
}

func parseMigrationForeignCall(input string) (string, string) {
	positions, calls := slices.Sorted(maps.Keys(migrationForeignCallPositions())), slices.Sorted(maps.Keys(migrationForeignCallCalls()))
	if position, call, ok := strings.Cut(input, "/"); ok && slices.Contains(positions, position) && slices.Contains(calls, call) {
		return position, call
	}
	sum := 0
	for i := range len(input) {
		sum = sum*31 + int(input[i])
	}
	if sum < 0 {
		sum = -sum
	}
	return positions[sum%len(positions)], calls[sum%len(calls)]
}

// migrationForeignCallErrors returns the errors left, without foreign-call diagnostics: a fix
// that would move what runs is refused, and the diagnostic says so.
func migrationForeignCallErrors(all []*ast.Diagnostic) (left []string, refused bool) {
	for _, d := range all {
		switch {
		case d.Category() != diagnostics.CategoryError:
		case d.Code() == vibelang.EK4401.Code || d.Code() == vibelang.EK0403.Code:
			refused = true
		default:
			left = append(left, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
	}
	return left, refused
}
