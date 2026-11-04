// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9203` | error: a plain return annotation is on a function or native generator whose body runs an Effect or can fail; [mapper example: plain-contract](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go) | 1, 4 | Keywords decide function kind; ordinary JavaScript throws follow the accepted thrown-type rules |
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2115` | error: legacy compiler compatibility — the stock TypeScript mapper sees an Effect-running call in a legacy factory's call-time body.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Example: `const make = (): Effect.Effect<number> => { Effect.log("building"); return () => 1 }`; [mapper example: factory-call](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4612` | error: legacy compiler compatibility — `join` appears inside a legacy hatch body.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Hatches are retired; put `join` in effect code.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Example: `function f(fiber: Fiber.Fiber<number>) { return sync(() => join fiber) }`; [mapper example: join-hatch](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9005` | error: the stock-TypeScript projection cannot choose a lowering from written types.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Its fatal refusal keeps the former mapper behavior; native editor advice retains EK9100.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | 34 | Add the requested annotation or compile with the native compiler.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9006` | error: the stock-TypeScript projection cannot prove a data-method receiver or access form.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Native editor annotation suggestions retain EK9101.
package vibelangmapper

import (
	"os"
	"regexp"
	"strconv"
	"testing"
)

// The expected identity comes from the row containing the executable host example.
func TestAppendixMapperHostExamples(t *testing.T) {
	appendix, err := os.ReadFile("../../../../docs/design/src/900-appendices.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, source string }{
		{"factory-call", `export const make = (): Effect.Effect<number> => { Effect.log("building"); return () => 1 }`},
		{"join-hatch", `function f(fiber: Fiber.Fiber<number>) { return sync(() => join fiber) }`},
		{"plain-contract", `export function greet(): number { Effect.log("x"); return 1 }`},
		{"form-choice", `import type { Port } from "./port.js"; export const wrap=(base:Port):Port => ({ read: (path) => { const program: Effect.Effect<number> = base.read(path); return program } })`},
		{"data-method", `import { get } from "./host"; const todos = get(); todos.map()`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pattern := "(?m)^\\| interim `(EK[0-9]+)` \\|[^\\n]*\\[mapper example: " + regexp.QuoteMeta(tc.name) + "\\]"
			row := regexp.MustCompile(pattern).FindSubmatch(appendix)
			if len(row) != 2 {
				t.Fatalf("missing Appendix row for %s", tc.name)
			}
			code, _ := strconv.Atoi(string(row[1][2:]))
			for _, p := range []Projection{Project(tc.source, testContext), Executable(tc.source, testContext)} {
				found := false
				for _, d := range p.Diagnostics {
					if d.Code == int32(code) {
						found = true
					}
				}
				if !found {
					t.Fatalf("Appendix expects EK%d, got %+v", code, p.Diagnostics)
				}
			}
		})
	}
}
