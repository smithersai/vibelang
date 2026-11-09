package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const matcherProviderQuote = "Every `.vibe` and `.vibex` source file sees the runtime's declaration of `SymbolConstructor.customMatcher`, including when `vibe.effectModules` or `vibe.effectGlobals` is disabled."

func TestMatcherProviderDiscoveryQuoted(t *testing.T) {
	chapterSays(t, "004-match.md", matcherProviderQuote)
}

func FuzzMatcherProviderDiscovery(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "004-match.md", matcherProviderQuote)
	f.Add("value-query", uint8(3))
	f.Add("class-key", uint8(5))
	rows := []struct{ key, binding, use string }{
		{"value-query", "const customMatcher=1;", "export type Key=typeof Symbol.customMatcher;"},
		{"function-query", "function customMatcher():number{return 1};", "export type Key=typeof Symbol.customMatcher;"},
		{"class-query", "class customMatcher{};", "export type Key=typeof Symbol.customMatcher;"},
		{"class-key", "const customMatcher=1;", "export class P{static [Symbol.customMatcher](s:unknown):boolean{return true}}"},
		{"object-key", "const customMatcher=1;", "export const P={[Symbol.customMatcher](s:unknown):boolean{return true}}"},
		{"shorthand-binding", "const {customMatcher}=Symbol;", "export type Key=typeof customMatcher;"},
		{"indexed-query", "", "export type Key=(typeof Symbol)[\"customMatcher\"];"},
		{"indexed-value", "", "export const key=Symbol[\"customMatcher\"];"},
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if key == "" {
			return
		}
		row := rows[int(key[0])%len(rows)]
		for _, r := range rows {
			if key == r.key {
				row = r
				break
			}
		}
		source := row.binding + row.use
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "Symbol", "S\\u0079mbol")
		}
		options := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"types\":[],\"skipLibCheck\":true,\"noEmit\":true}"
		if mode&2 != 0 {
			options += ",\"vibe\":{\"effectModules\":false,\"effectGlobals\":false}"
		}
		options += "}"
		for _, native := range []bool{false, true} {
			name := "main.vibe"
			if mode&4 != 0 {
				name = "main.vibex"
			}
			text := source
			if native {
				name = "main.ts"
				text = "import \"vibelang-runtime\";" + text
			}
			r, err := w.Compile(t.Context(), Project{Config: options, Files: map[string]string{name: text}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzMatcherProviderDiscovery", row.key, "provider discovery native=%t mode=%d: %s%d: %s", native, mode, d.Source(), d.Code(), d.String())
				}
			}
		}
	})
}
