package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A base constructor's rethrows contract applies at the explicit super call,
// just as it does at a new expression. Its own never does not erase callbacks.
func TestSuperCallRethrows(t *testing.T) {
	const library = `/** @throws {RangeError} */
export declare function risky(): number
/** @throws {never} */
export declare function safe(): number
export declare function untagged(): number
export declare class Base {
 /**
  * @throws {never}
  * @rethrows cb
  */
 constructor(cb: () => number)
}
export declare class Generic<T> {
 /**
  * @throws {never}
  * @rethrows cb
  */
 constructor(cb: () => T)
}
export declare class Rest {
 /**
  * @throws {never}
  * @rethrows callbacks
  */
 constructor(...callbacks: (() => number)[])
}
export declare class Own {
 /**
  * @throws {RangeError}
  * @rethrows cb
  */
 constructor(cb: () => number)
}
`
	for _, row := range []struct {
		name, declarations, body string
		rejects                  bool
	}{
		{"known", "", "⟦super(risky)⟧", true},
		{"literal", "", "⟦super(() => risky())⟧", true},
		{"conditional", "", "⟦super(flag ? risky : safe)⟧", true},
		{"alias", "const saved = risky\n", "⟦super(saved)⟧", true},
		{"spread", "const callbacks = [risky] as const\n", "⟦super(...callbacks)⟧", true},
		{"generic", "", "⟦super(risky)⟧", true},
		{"rest", "", "⟦super(safe, risky)⟧", true},
		{"own", "", "⟦super(risky)⟧", true},
		{"safe", "", "super(safe)", false},
		{"untagged", "", "super(untagged)", false},
		{"local", "", "super(() => 1)", false},
		{"caught-call", "", "try { super(risky) } catch { super(safe) }", false},
		{"caught-literal", "", "super(() => { try { return risky() } catch { return 1 } })", false},
		{"nested-source", "", "super(() => { const nested = () => ⟦risky()⟧; return 1 })", true},
	} {
		for _, extension := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+extension, func(t *testing.T) {
				base := "Base"
				switch row.name {
				case "generic":
					base = "Generic<number>"
				case "rest":
					base = "Rest"
				case "own":
					base = "Own"
				}
				source := "import { risky, safe, untagged, Base, Generic, Rest, Own } from \"./lib.js\"\ndeclare const flag: boolean\n" + row.declarations + "export class Derived extends " + base + " { constructor() { " + row.body + " } }"
				start := strings.Index(source, "⟦")
				end := strings.Index(source, "⟧") - len("⟦")
				source = strings.ReplaceAll(strings.ReplaceAll(source, "⟦", ""), "⟧", "")
				program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + extension: library})
				errors := 0
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
					if diagnostic.Category() != diagnostics.CategoryError {
						continue
					}
					errors++
					if !row.rejects || diagnostic.Source() != diagnosticSource || diagnostic.Code() != 401 || diagnostic.Pos() > end || diagnostic.End() < start {
						t.Errorf("unexpected diagnostic: %s", diagnostic.String())
					}
					if !strings.Contains(diagnostic.String(), "RangeError") {
						t.Errorf("lost callback thrown type: %s", diagnostic.String())
					}
				}
				want := 0
				if row.rejects {
					want = 1
				}
				if errors != want {
					t.Errorf("got %d errors, want %d at the marked site", errors, want)
				}
			})
		}
	}
}
