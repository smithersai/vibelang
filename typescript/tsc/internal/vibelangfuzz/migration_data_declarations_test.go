package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
)

const migrationDataDeclarationsTarget = "FuzzMigrationDataDeclarations"
const migrationDataDeclarationsQuote = "Exported `schema` and `data` declarations emit the TypeScript declarations of their Effect TypeScript counterparts above"

func TestMigrationDataDeclarationsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), migrationDataDeclarationsQuote) {
		t.Fatalf("Chapter6 no longer says %q", migrationDataDeclarationsQuote)
	}
}

func migrationDataDeclarationPairs() map[string][2]string {
	pairs := map[string][2]string{}
	for key, payload := range map[string]string{
		"number": "value: number", "string": "value: string",
		"optional": "value?: number", "readonly": "readonly value: number",
		"union": "value: number | string", "tuple": "value: [number, string]",
		"nested":            "value: { count: number }",
		"foldkit-lazy-miss": "previousCount: number; currentCount: number",
	} {
		name, first, second := "Reason", "Empty", "Row"
		if key == "foldkit-lazy-miss" {
			name, first, second = "LazyMissReason", "NoCachedEntry", "ArgumentCountChanged"
		}
		head := "import { Data } from \"effect\";\n"
		pairs[key] = [2]string{
			head + "export data " + name + " { " + first + "; " + second + " { " + payload + " } }\n",
			head + "export type " + name + " = Data.TaggedEnum<{ " + first + ": {}; " + second + ": { " + payload + " } }>;\nexport const " + name + " = Data.taggedEnum<" + name + ">();\n",
		}
	}
	pairs["fieldless"] = [2]string{
		"import { Data } from \"effect\"; export data Reason { Empty; Other }\n",
		"import { Data } from \"effect\"; export type Reason = Data.TaggedEnum<{Empty:{}; Other:{}}>; export const Reason = Data.taggedEnum<Reason>();\n",
	}
	return pairs
}

// Foldkit16 and the published-package byte-identity ruling require the public
// declaration bytes of the documented TypeScript counterpart. Do not
// canonicalize away module spelling, comments, or declaration structure.
// Each fixture exports its entire single-module declaration surface.
func FuzzMigrationDataDeclarations(f *testing.F) {
	startShortBudget(f)
	pairs := migrationDataDeclarationPairs()
	keys := []string{}
	for key := range pairs {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationDataDeclarationsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		pair := pairs[key]
		sides := []map[string]string{}
		for i, source := range pair {
			name := "main.vibe"
			if i == 1 {
				name = "main.ts"
			}
			var result *Result
			var err error
			within(t, "emit data counterpart", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				Gap(t, migrationDataDeclarationsTarget, fmt.Sprintf("admission:%s:%d", key, i), "Chapter6: %q; counterpart must compile: %v\n%s", migrationDataDeclarationsQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			declarations := map[string]string{}
			for name, text := range result.Outputs {
				if strings.HasSuffix(name, ".d.ts") {
					declarations[name] = text
				}
			}
			if len(declarations) == 0 {
				t.Fatal("data counterpart emitted no declarations")
			}
			sides = append(sides, declarations)
		}
		if !maps.Equal(sides[0], sides[1]) {
			Gap(t, migrationDataDeclarationsTarget, "bytes:"+key,
				"Chapter6: %q; published declarations must preserve the documented counterpart byte for byte:\nnative: %q\nTypeScript: %q",
				migrationDataDeclarationsQuote, sides[0], sides[1])
		}
		ExpectPending(t, migrationDataDeclarationsTarget, "bytes:"+key)
		ExpectPending(t, migrationDataDeclarationsTarget, "admission:"+key+":0")
		ExpectPending(t, migrationDataDeclarationsTarget, "admission:"+key+":1")
		ExpectPending(t, migrationDataDeclarationsTarget, specCorpusKey(t))
	})
}
