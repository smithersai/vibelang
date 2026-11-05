package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestDestructuredReceiverThrows(t *testing.T) {
	for _, bound := range []string{"never", "RangeError"} {
		for _, shape := range []struct{ name, binding string }{
			{"object", "const {read}=reader;"},
			{"renamed", "const {read:readAlias}=reader;const read=readAlias;"},
			{"nested", "const {reader:{read}}=nested;"},
			{"string-key", "const {'read':read}=reader;"},
			{"computed-key", "const {['read']:read}=reader;"},
			{"nested-array", "const [{read}]=[reader];"},
		} {
			for _, plain := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/plain=%t", bound, shape.name, plain), func(t *testing.T) {
					lib := "export interface Reader<T>{\n/** @throws {T} */\nread(s:string):number\n}\nexport declare const reader:Reader<" + bound + ">\nexport declare const nested:{reader:Reader<" + bound + ">}"
					effect := "effect "
					if plain {
						effect = ""
					}
					source := "import {reader,nested} from './lib.js';export " + effect + "function probe(s:string){" + shape.binding + "return read(s)}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
					count := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						count++
						code := int32(403)
						if plain {
							code = 401
						}
						if bound == "never" || d.Code() != code || d.Source() != diagnosticSource {
							t.Errorf("unexpected diagnostic: %s", d.String())
						}
						if bound != "never" && !plain && !strings.Contains(d.String(), "RangeError") {
							t.Errorf("lost substitution: %s", d.String())
						}
					}
					want := 0
					if bound != "never" {
						want = 1
					}
					if count != want {
						t.Errorf("got %d errors,want %d", count, want)
					}
				})
			}
		}
	}
}

func TestDestructuredReceiverBoundaries(t *testing.T) {
	for _, shape := range []struct{ name, binding string }{
		{"written-root", "const {read}:Reader<RangeError>=reader;"},
		{"asserted-root", "const {read}=reader as Reader<RangeError>;"},
	} {
		t.Run(shape.name, func(t *testing.T) {
			lib := "export interface Reader<T>{\n/** @throws {T} */\nread(s:string):number\n}\nexport declare const reader:Reader<never>"
			source := "import {Reader,reader} from './lib.js';export effect function probe(s:string){" + shape.binding + "return read(s)}"
			program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				count++
				if d.Code() != 403 || d.Source() != diagnosticSource || !strings.Contains(d.String(), "RangeError") {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != 1 {
				t.Errorf("got %d errors,want1", count)
			}
		})
	}
}

// Defaults may select a different receiver contract; do not inherit only the source owner.
func TestDestructuredReceiverDefaults(t *testing.T) {
	for _, binding := range []string{
		"const {read=other.read}=reader;",
		"const {reader:{read}=other}=nested;",
	} {
		t.Run(binding, func(t *testing.T) {
			lib := "export interface Reader<T>{\n/** @throws {T} */\nread(s:string):number\n}\nexport declare const reader:Partial<Reader<never>>\nexport declare const other:Reader<RangeError>\nexport declare const nested:{reader?:Reader<never>}"
			source := "import {reader,other,nested} from './lib.js';export effect function probe(s:string){" + binding + "return read(s)}"
			program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				count++
				if d.Code() != 403 || d.Source() != diagnosticSource {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != 1 {
				t.Errorf("got %d errors,want one non-never call", count)
			}
		})
	}
}
