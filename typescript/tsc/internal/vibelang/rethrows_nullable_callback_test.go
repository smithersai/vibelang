package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3: a callee's own never does not erase its rethrown callback's
// written contract. Optional parameters and nullish unions retain that rule.
func TestRethrowsNullableCallback(t *testing.T) {
	for _, ext := range []string{"ts", "d.ts"} {
		for _, target := range []struct{ key, parameter string }{
			{"required", "cb: (n: number) => number"},
			{"optional", "cb?: (n: number) => number"},
			{"undefined", "cb: ((n: number) => number) | undefined"},
			{"null", "cb: ((n: number) => number) | null"},
			{"nullish", "cb: ((n: number) => number) | null | undefined"},
		} {
			library := "/** @throws {RangeError} */\nexport declare function risky(n: number): number\n" +
				"/** @throws {never} */\nexport declare function safe(n: number): number\n" +
				"/** @throws {never}\n * @rethrows cb\n */\nexport declare function invoke(" + target.parameter + "): number\n"
			for _, row := range []struct {
				name, host, body string
				code             int32
			}{
				{"effect-risky", "effect ", "return invoke(risky)", 403},
				{"plain-risky", "", "return invoke(risky)", 401},
				{"effect-safe", "effect ", "return invoke(safe)", 0},
				{"plain-safe", "", "return invoke(safe)", 0},
				{"plain-caught", "", "try { return invoke(risky) } catch { return 0 }", 0},
				{"effect-bridge", "effect ", "return try Effect.try(() => invoke(risky))", 0},
				{"effect-alias", "effect ", "const callback = risky; return invoke(callback)", 403},
				{"plain-alias", "", "const callback = risky; return invoke(callback)", 401},
				{"async-risky", "async ", "return invoke(risky)", 0},
			} {
				t.Run(fmt.Sprintf("%s/%s/%s", target.key, row.name, ext), func(t *testing.T) {
					source := "import {invoke, risky, safe} from './lib.js'\nexport " + row.host + "function probe() {" + row.body + "}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: library})
					codes := []int32{}
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, d.Code())
						}
					}
					want := 0
					if row.code != 0 {
						want = 1
					}
					if len(codes) != want || want == 1 && codes[0] != row.code {
						t.Fatalf("got %v, want code %d", codes, row.code)
					}
				})
			}
		}
	}
}

func TestRethrowsOptionalArraySort(t *testing.T) {
	const library = "/** @throws {RangeError} */\nexport declare function risky(a: number, b: number): number\n/** @throws {never} */\nexport declare function safe(a: number, b: number): number\n"
	for _, row := range []struct {
		name, host, body string
		code             int32
	}{
		{"effect-risky", "effect ", "return [2,1].sort(risky)", 403},
		{"plain-risky", "", "return [2,1].sort(risky)", 401},
		{"effect-safe", "effect ", "return [2,1].sort(safe)", 0},
		{"plain-safe", "", "return [2,1].sort(safe)", 0},
		{"effect-undefined", "effect ", "return [2,1].sort(undefined)", 0},
		{"effect-absent", "effect ", "return [2,1].sort()", 0},
		{"plain-caught", "", "try { return [2,1].sort(risky) } catch { return [] }", 0},
		{"effect-bridge", "effect ", "return try Effect.try(() => [2,1].sort(risky))", 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "import {risky,safe} from './lib.js'\nexport " + row.host + "function probe(){" + row.body + "}"
			program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": library})
			codes := []int32{}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			want := 0
			if row.code != 0 {
				want = 1
			}
			if len(codes) != want || want == 1 && codes[0] != row.code {
				t.Fatalf("got %v,want code %d", codes, row.code)
			}
		})
	}
}
