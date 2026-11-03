package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestModuleMetadataBoundsQuoted(t *testing.T) {
	for _, quote := range []string{
		"\x60import.meta\x60 may appear only as the object of \x60.url\x60",
		"Every other member (\x60dirname\x60, \x60filename\x60, \x60env\x60, \x60main\x60, \x60resolve\x60, host additions such as Vite's \x60hot\x60) and every other use of \x60import.meta\x60 (an alias, destructuring, a computed key, an argument, a spread) is \x60EK4402\x60.",
	} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("Chapter 5 no longer says %q", quote)
		}
	}
}

type metadataBoundCase struct {
	key, expression string
	forbidden       bool
}

func metadataBoundCases() []metadataBoundCase {
	return []metadataBoundCase{
		{"url", "import.meta.url", false},
		{"dirname", "import.meta.dirname", true},
		{"filename", "import.meta.filename", true},
		{"env", "import.meta.env.VITE_FOLDKIT_CANARY_COMMIT", true},
		{"main", "import.meta.main", true},
		{"hot", "import.meta.hot", true},
		{"resolve", "import.meta.resolve('./asset')", true},
		{"glob", "import.meta.glob<string>('./*.md', { query: '?raw', import: 'default', eager: true })", true},
		{"alias", "import.meta", true},
		{"computed-url", "import.meta['url']", true},
		{"argument", "Boolean(import.meta)", true},
		{"spread", "({ ...import.meta })", true},
	}
}

// Foldkit124–126: retain the accepted boundary while the consumer/platform
// owners implement the distinct directory, Vite-macro and entry counterparts.
// This target does not invent those APIs or replace compile-time Vite inputs
// with a runtime filesystem read.
func FuzzModuleMetadataBounds(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#52acbff1ca95c8ce
	// Chapter 005: only import.meta.url is allowed; host members and object escapes reject across callable homes (FuzzModuleMetadataBounds).

	// Spec rule: docs/design/src/005-services.md#7bb0b4abc2dc6987
	// Chapter 005: only import.meta.url is allowed; host members and object escapes reject across callable homes (FuzzModuleMetadataBounds).

	startShortBudget(f)
	rows := metadataBoundCases()
	for _, row := range rows {
		for home := uint8(0); home < 4; home++ {
			f.Add(row.key, home)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestModuleMetadataBoundsQuoted(t)
		index := slices.IndexFunc(rows, func(row metadataBoundCase) bool { return row.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rows)
		}
		row := rows[index]
		home := variant % 4
		expression := row.expression
		switch variant / 4 % 3 {
		case 1:
			expression = "(" + expression + ")"
		case 2:
			expression = "/* metadata */ " + expression
		}
		body := "export const value = " + expression + ";\n"
		native := body
		if home == 1 {
			body = "export function read(){ return " + expression + "; }\n"
			native = body
		}
		if home == 2 {
			body = "export const read = () => " + expression + ";\n"
			native = body
		}
		if home == 3 {
			body = "export effect function read(){ return " + expression + "; }\n"
			native = "export function read(){ return " + expression + "; }\n"
		}
		config, _ := json.Marshal(map[string]any{
			"compilerOptions": map[string]any{"module": "NodeNext", "moduleResolution": "NodeNext", "target": "ES2022", "strict": true, "types": []string{}, "skipLibCheck": true, "noEmit": true},
			"files":           []string{"main.vibe", "metadata.d.ts"},
		})
		ambient := "interface ImportMeta { readonly dirname:string; readonly filename:string; readonly env:Record<string,string>; readonly main:boolean; readonly hot:object|undefined; resolve(path:string):string; glob<T>(pattern:string,options:object):Record<string,T> }\n"
		compile := func(name, source string) *Result {
			cfg := string(config)
			if name == "main.ts" {
				cfg = strings.Replace(cfg, "main.vibe", "main.ts", 1)
			}
			var result *Result
			var err error
			within(t, "check module metadata boundary", func() {
				result, err = w.Compile(t.Context(), Project{
					Files: map[string]string{name: source, "metadata.d.ts": ambient, "package.json": "{\"type\":\"module\"}"}, Config: cfg,
				})
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			return result
		}
		control := compile("main.ts", native)
		if HasError(control.Diagnostics) {
			t.Fatalf("invalid native metadata control %s: %v", row.key, SortedKeys(Keys(control.Dir, control.Diagnostics)))
		}
		result := compile("main.vibe", body)
		hasBoundary := false
		unexpected := false
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(diagnostic) && diagnostic.Code() == 4402 {
				hasBoundary = true
			} else {
				unexpected = true
			}
		}
		gaps := &Gaps{Target: "FuzzModuleMetadataBounds", Input: body}
		rule := fmt.Sprintf("%s:%d:%d", row.key, home, variant/3%3)
		if hasBoundary != row.forbidden || !row.forbidden && unexpected {
			gaps.Add(rule, "VIP-33/detail90 requires only .url metadata access; forbidden=%t, diagnostics=%v", row.forbidden, SortedKeys(Keys(result.Dir, result.Diagnostics)))
		} else {
			ExpectPending(t, "FuzzModuleMetadataBounds", rule)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
