package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// VIP-6: clashing names are qualified; language statements keep their helpers.
func TestScopeHelperKeywordBindings(t *testing.T) {
	TestEffectGlobalsQuoted(t)
	w := NewWorkspace(t)
	for _, config := range []struct{ name, value string }{
		{"default", ""},
		{"globals-off", effectGlobalsConfig("{ \"effectGlobals\": false }")},
		{"modules-off", effectGlobalsConfig("{ \"effectModules\": false }")},
	} {
		for _, word := range []string{"interruptible", "uninterruptible"} {
			prefix := "import * as Effect from \"effect/Effect\";\n"
			for _, form := range []struct{ name, source string }{
				{"value", "export const probe: typeof Effect.%s = %s;\n"},
				{"type-query", "export type Probe = typeof %s;\n"},
				{"effect-body", "export effect function read() { return %s; }\n"},
			} {
				t.Run(config.name+"/"+word+"/"+form.name, func(t *testing.T) {
					source := strings.ReplaceAll(form.source, "%s", word)
					got := compileEffectGlobal(t, w, Project{Files: map[string]string{"main.vibe": prefix + source}, Config: config.value})
					if len(got) == 0 {
						t.Fatal("keyword resolved as an ordinary source global")
					}
					for _, key := range got {
						if key.Source != "" && key.Source != "TS" || key.Code != 2304 && key.Code != 2552 {
							t.Fatalf("want missing source name, got %v", got)
						}
					}
				})
			}
			t.Run(config.name+"/"+word+"/qualified", func(t *testing.T) {
				source := prefix + fmt.Sprintf("export const probe = Effect.%s;\nconst box = { %s: Effect.%s };\nexport const member = box.%s;\n", word, word, word, word)
				if got := compileEffectGlobal(t, w, Project{Files: map[string]string{"main.vibe": source}, Config: config.value}); len(got) != 0 {
					t.Fatalf("qualified native function: %v", got)
				}
			})
		}
		t.Run(config.name+"/statements", func(t *testing.T) {
			source := "import * as Effect from \"effect/Effect\";\nexport effect function read() { let total = 0; uninterruptible { total += 1; restore { total += 1; }; interruptible { total += 1; } }; return total }\n"
			if got := compileEffectGlobal(t, w, Project{Files: map[string]string{"main.vibe": source}, Config: config.value}); len(got) != 0 {
				t.Fatalf("interruption statements: %v", got)
			}
		})
	}
}
