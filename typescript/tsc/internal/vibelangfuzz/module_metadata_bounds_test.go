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
		"Members are checked against the program's `ImportMeta` declarations.",
	} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("Chapter 5 no longer says %q", quote)
		}
	}
}

type metadataBoundCase struct {
	key, expression string
	want            int32
}

func metadataBoundCases() []metadataBoundCase {
	return []metadataBoundCase{
		{"url", "import.meta.url", 0},
		{"dirname", "import.meta.dirname", 0},
		{"filename", "import.meta.filename", 0},
		{"env", "import.meta.env.VITE_FOLDKIT_CANARY_COMMIT", 0},
		{"main", "import.meta.main", 0},
		{"hot", "import.meta.hot", 0},
		{"resolve", "import.meta.resolve('./asset')", 0},
		{"glob", "import.meta.glob<string>('./*.md', { query: '?raw', import: 'default', eager: true })", 0},
		{"alias", "import.meta", 0},
		{"computed-url", "import.meta['url']", 0},
		{"argument", "Boolean(import.meta)", 0},
		{"spread", "({ ...import.meta })", 0},
		{"undeclared", "import.meta.undeclaredMember", 2339},
	}
}

// VIP-33 amendment: declarations determine metadata access in every callable home.
func FuzzModuleMetadataBounds(f *testing.F) {
	// Spec rule: docs/design/src/005-services.md#8a4271c66660c37c
	// Chapter 005: metadata members follow ImportMeta declarations across callable homes (FuzzModuleMetadataBounds).

	// Spec rule: docs/design/src/005-services.md#77d844734bc21156
	// Chapter 005: metadata members follow ImportMeta declarations across callable homes (FuzzModuleMetadataBounds).

	// Spec rule: docs/design/src/005-services.md#093fe9c889a52f8a
	// Chapter 005: metadata members follow ImportMeta declarations across callable homes (FuzzModuleMetadataBounds).

	// Spec rule: docs/design/src/005-services.md#25e2b783d54ba566
	// Chapter 005: metadata members follow ImportMeta declarations across callable homes (FuzzModuleMetadataBounds).

	// Spec rule: docs/design/src/005-services.md#52acbff1ca95c8ce
	// Chapter 005: metadata members follow ImportMeta declarations across callable homes (FuzzModuleMetadataBounds).

	// Spec rule: docs/design/src/005-services.md#7bb0b4abc2dc6987
	// Chapter 005: metadata members follow ImportMeta declarations across callable homes (FuzzModuleMetadataBounds).

	startShortBudget(f)
	rows := metadataBoundCases()
	// One seed for each home and key class of a row: a pending line names
	// all three, and a line no seed reaches is never judged.
	for _, row := range rows {
		seeded := map[[2]uint8]bool{}
		for variant := uint8(0); variant < 36; variant++ {
			if class := [2]uint8{variant % 4, variant / 3 % 3}; !seeded[class] {
				seeded[class] = true
				f.Add(row.key, variant)
			}
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
			body = "export effect function read(){ return try Effect.try(() => " + expression + "); }\n"
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
		result := compile("main.vibe", body)
		valid := func(result *Result) bool {
			count := 0
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				count++
				if row.want == 0 || IsEK(d) || d.Code() != row.want {
					return false
				}
			}
			return count == 0 && row.want == 0 || count == 1 && row.want != 0
		}
		gaps := &Gaps{Target: "FuzzModuleMetadataBounds", Input: body}
		rule := fmt.Sprintf("%s:%d:%d", row.key, home, variant/3%3)
		if !valid(control) || !valid(result) {
			gaps.Add(rule, "VIP-33 metadata uses ImportMeta declarations; want TS%d, native=%v, vibe=%v", row.want, SortedKeys(Keys(control.Dir, control.Diagnostics)), SortedKeys(Keys(result.Dir, result.Diagnostics)))
		} else {
			ExpectPending(t, "FuzzModuleMetadataBounds", rule)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
