package vibelangfuzz

import (
	"strings"
	"testing"
)

const tryOperationOperandQuote = "The four concurrent array operations require assignability to `ReadonlyArray<Effect.Effect<any, any, any>>` (`EK1801`)"

const tryOperationSettledOperandQuote = "any other operand `xs`: `const $xs = xs; yield* Effect.all($xs.map(Effect.exit), { concurrency: \"unbounded\" })`"

func TestTryOperationOperandQuoted(t *testing.T) {
	chapter := SpecText("002-running.md")
	for _, quote := range []string{tryOperationOperandQuote, tryOperationSettledOperandQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("VIP-18 operand rule changed: %s", quote)
		}
	}
}

// Generate native assignment controls beside each operation. The oracle is
// Chapter 2's named operand domain, independent of the lowering's inference.
func tryOperationOperandCases() []reviewContractCase {
	var rows []reviewContractCase
	for _, operation := range []string{"all", "race", "any", "allSettled"} {
		for _, operand := range []struct {
			key, typ string
			reject   bool
		}{
			{"any", "any", false},
			{"any-array", "any[]", false},
			{"readonly-any-array", "ReadonlyArray<any>", false},
			{"any-tuple", "readonly [any]", false},
			{"mixed-any-tuple", "readonly [Effect.Effect<number>, any]", false},
			{"never-array", "never[]", false},
			{"never", "never", false},
			{"optional-any-tuple", "readonly [any?]", false},
			{"empty-tuple", "readonly []", false},
			{"array-union", "ReadonlyArray<Effect.Effect<number>> | any[]", false},
			{"unknown", "unknown", true},
			{"unknown-array", "unknown[]", true},
			{"number-array", "number[]", true},
			{"function-array", "ReadonlyArray<() => Effect.Effect<number>>", true},
			{"optional-array", "ReadonlyArray<Effect.Effect<number>> | undefined", true},
		} {
			for _, wrapped := range []bool{false, true} {
				key := operation + "-" + operand.key
				value := "input"
				if wrapped {
					key += "-wrapped"
					value = "(input as " + operand.typ + ")"
				}
				code := int32(0)
				if operand.reject {
					code = 1801
				}
				native := "import * as Effect from \"effect/Effect\"; declare const input: " + operand.typ + "; const check: ReadonlyArray<Effect.Effect<any, any, any>> = " + value + "; export {check};"
				nativeReject := operand.reject
				if operation == "allSettled" && operand.key == "never" {
					// The domain admits never, but the specified named-operand
					// counterpart must still typecheck its native map access.
					code = 2339
					nativeReject = true
					native += " Effect.all((" + value + ").map(Effect.exit), { concurrency: \"unbounded\" });"
				}
				rows = append(rows, reviewContractCase{
					key:    key,
					source: "import * as Effect from \"effect/Effect\"; export effect function probe(input: " + operand.typ + ") { return try." + operation + " " + value + "; }",
					native: native,
					code:   code, nativeReject: nativeReject,
				})
			}
		}
	}
	return rows
}

func FuzzTryOperationOperandDomain(f *testing.F) {
	startShortBudget(f)
	fuzzReviewContract(f, "FuzzTryOperationOperandDomain")
}
