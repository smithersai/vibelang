package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestMatcherProviderDiscovery(t *testing.T) {
	rows := []struct {
		name, source string
		provider     bool
	}{
		{"value-query", "const customMatcher=1;export type Key=typeof Symbol.customMatcher", true},
		{"function-query", "function customMatcher():number{return 1};export type Key=typeof Symbol.customMatcher", true},
		{"class-query", "class customMatcher{};export type Key=typeof Symbol.customMatcher", true},
		{"class-key", "const customMatcher=1;export class P{static [Symbol.customMatcher](s:unknown):boolean{return true}}", true},
		{"object-key", "const customMatcher=1;export const P={[Symbol.customMatcher](s:unknown):boolean{return true}}", true},
		{"escaped-query", "const customMatcher=1;export type Key=typeof S\\u0079mbol.customMatcher", true},
		{"shorthand-binding", "const {customMatcher}=Symbol;export type Key=typeof customMatcher", true},
		{"renamed-binding", "const customMatcher=1;const {customMatcher:key}=Symbol;export type Key=typeof key", true},
		{"indexed-query", "export type Key=(typeof Symbol)[\"customMatcher\"]", true},
		{"indexed-value", "export const key=Symbol[\"customMatcher\"]", true},
		{"indexed-alias", "const S=Symbol;export type Key=(typeof S)[\"customMatcher\"]", true},
		{"ordinary-symbol", "const customMatcher=1;export const key=Symbol.iterator", false},
		{"unrelated-property", "const customMatcher=1;export const key={customMatcher:1}", false},
	}
	for _, disabled := range []bool{false, true} {
		for _, row := range rows {
			name := row.name
			config := editorTsconfig
			if disabled {
				name += "/disabled"
				config = "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"vibe\":{\"effectModules\":false,\"effectGlobals\":false},\"files\":[\"main.vibe\"]}"
			}
			t.Run(name, func(t *testing.T) {
				p, f, _, _ := editorProgramConfig(t, row.source, editorPackageJSON, editorPackages, config)
				prelude, root, _ := mayUsePrelude(f)
				t.Logf("dependency discovery: prelude=%t effectRoot=%t", prelude, root)
				if prelude != row.provider {
					t.Errorf("runtime provider=%t,want %t", prelude, row.provider)
				}
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
					}
				}
			})
		}
	}
}
