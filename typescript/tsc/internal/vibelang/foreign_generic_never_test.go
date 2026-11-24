package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestForeignGenericNever(t *testing.T) {
	for _, bound := range []struct {
		key, text string
		throwing  bool
	}{
		{"never", "never", false}, {"range", "RangeError", true},
	} {
		for _, shape := range []struct{ key, lib, call string }{
			{"function", "/** @throws {T} */\nexport declare function read<T>():number", "read<%s>()"},
			{"default", "/** @throws {T} */\nexport declare function read<T=never>():number", "read<%s>()"},
			{"callable", "export interface Reader<T>{\n/** @throws {T} */\n():number}\nexport declare const read:Reader<%s>", "read()"},
			{"method", "export interface Reader<T>{\n/** @throws {T} */\nread():number}\nexport declare const read:Reader<%s>", "read.read()"},
			{"inherited-method", "export interface Base<T>{\n/** @throws {T} */\nread():number}\nexport interface Reader<U> extends Base<U>{}\nexport declare const read:Reader<%s>", "read.read()"},
			{"constructor", "export declare class read<T>{\n/** @throws {T} */\nconstructor()}", "new read<%s>()"},
			{"tag", "/** @throws {T} */\nexport declare function read<T>(parts:TemplateStringsArray):number", "read<%s>`value`"},
		} {
			for _, plain := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/plain=%t", bound.key, shape.key, plain), func(t *testing.T) {
					lib := strings.ReplaceAll(shape.lib, "%s", bound.text)
					call := strings.ReplaceAll(shape.call, "%s", bound.text)
					effect := "effect "
					if plain {
						effect = ""
					}
					source := "import {read} from './lib.js';export " + effect + "function probe(){return " + call + "}"
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
						if !bound.throwing || d.Source() != diagnosticSource || d.Code() != code {
							t.Errorf("unexpected diagnostic: %s", d.String())
						}
						if bound.throwing && !strings.Contains(d.String(), "'RangeError'") {
							t.Errorf("uninstantiated diagnostic: %s", d.String())
						}
					}
					want := 0
					if bound.throwing {
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
