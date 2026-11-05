package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestGenericReceiverAlias(t *testing.T) {
	for _, row := range []struct {
		key, bound string
		throwing   bool
	}{{"never", "never", false}, {"range", "RangeError", true}} {
		for _, binding := range []struct{ key, body string }{
			{"direct", "return reader.read(s)"},
			{"alias", "const read=reader.read;return read(s)"},
			{"chain", "const first=reader.read;const read=first;return read(s)"},
			{"parenthesized", "const read=((reader.read));return read(s)"},
			{"element", "const read=reader['read'];return read(s)"},
			{"namespace", "const read=foreign.reader.read;return read(s)"},
		} {
			for _, plain := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/plain=%t", row.key, binding.key, plain), func(t *testing.T) {
					lib := "export interface Reader<T>{\n/** @throws {T} */\nread(s:string):unknown\n}\nexport declare const reader:Reader<" + row.bound + ">"
					effect := "effect "
					if plain {
						effect = ""
					}
					source := "import {reader} from './lib.js';import * as foreign from './lib.js';export " + effect + "function probe(s:string){" + binding.body + "}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
					errors := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						errors++
						code := int32(403)
						if plain {
							code = 401
						}
						if !row.throwing || d.Source() != diagnosticSource || d.Code() != code {
							t.Errorf("unexpected diagnostic: %s", d.String())
						}
						if row.throwing && !plain && !strings.Contains(d.String(), "RangeError") {
							t.Errorf("lost receiver substitution: %s", d.String())
						}
					}
					want := 0
					if row.throwing {
						want = 1
					}
					if errors != want {
						t.Errorf("got %d errors, want %d", errors, want)
					}
				})
			}
		}
	}
}

func TestGenericReceiverAliasBoundaries(t *testing.T) {
	for _, row := range []struct{ name, binding string }{
		{"written-indexed", "const read:Reader<RangeError>['read']=reader.read;"},
		{"asserted-indexed", "const read=reader.read as Reader<RangeError>['read'];"},
	} {
		t.Run(row.name, func(t *testing.T) {
			lib := "export interface Reader<T>{\n/** @throws {T} */\nread(s:string):unknown\n}\nexport declare const reader:Reader<never>"
			source := "import {Reader,reader} from './lib.js';export effect function probe(s:string){" + row.binding + "return read(s)}"
			program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
			errors := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				errors++
				if d.Source() != diagnosticSource || d.Code() != 403 {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if errors != 1 {
				t.Errorf("got %d errors, want one non-never call diagnostic", errors)
			}
		})
	}
}
