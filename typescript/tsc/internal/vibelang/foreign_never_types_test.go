package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// Chapter 3: a written throws contract is a TypeScript type, including never.
func TestForeignNeverTypes(t *testing.T) {
	for _, row := range []struct {
		name, declarations, bound string
		throwing                  bool
	}{
		{"keyword", "", "never", false},
		{"alias", "type Quiet = never;", "Quiet", false},
		{"parenthesized", "type Quiet = never;", "(Quiet)", false},
		{"union", "type Quiet = never;", "Quiet | never", false},
		{"extract", "", "Extract<string, number>", false},
		{"exclude", "", "Exclude<'value', 'value'>", false},
		{"intersection", "", "string & number", false},
		{"generic-alias", "type Empty<T> = Exclude<T, T>;", "Empty<string>", false},
		{"unknown-control", "type Bound = unknown;", "Bound", true},
		{"range-control", "type Bound = RangeError | never;", "Bound", true},
		{"array-control", "", "never[]", true},
	} {
		for _, style := range []string{"binding", "function", "property"} {
			for _, home := range []string{"effect", "plain"} {
				t.Run(row.name+"/"+style+"/"+home, func(t *testing.T) {
					lib := row.declarations + "\n/** @throws {" + row.bound + "} */\n"
					call := "read(s)"
					switch style {
					case "binding":
						lib += "export declare const read: typeof JSON.parse"
					case "function":
						lib += "export declare function read(s:string):unknown"
					case "property":
						lib = row.declarations + "\nexport declare const read: {\n/** @throws {" + row.bound + "} */\nparse:typeof JSON.parse\n}"
						call = "read.parse(s)"
					}
					effect := ""
					if home == "effect" {
						effect = "effect "
					}
					source := fmt.Sprintf("import {read} from './lib.js'; export %sfunction probe(s:string){return %s}", effect, call)
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
					var codes []int32
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						codes = append(codes, d.Code())
						want := int32(401)
						if home == "effect" {
							want = 403
						}
						if !row.throwing || d.Source() != diagnosticSource || d.Code() != want {
							t.Errorf("unexpected diagnostic: %s", d.String())
						}
					}
					want := 0
					if row.throwing {
						want = 1
					}
					if len(codes) != want {
						t.Errorf("got errors %v, want %d", codes, want)
					}
				})
			}
		}
	}
}
