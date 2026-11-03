package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestVibexDeclarationSpellingQuoted(t *testing.T) {
	const quote = "The public \x60x.d.ts\x60 is API-identical ([VIP-27](0027-declaration-output.md)) to the one the fork writes for the \x60.tsx\x60 twin that carries the same \x60@throws\x60 tags."
	if !strings.Contains(SpecText("../vips/0039-vibex.md"), quote) {
		t.Fatalf("VIP39 no longer says %q", quote)
	}
}

type vibexDeclarationCase struct{ key, jsx, form, quote string }

func vibexDeclarationCases() []vibexDeclarationCase {
	var rows []vibexDeclarationCase
	for _, jsx := range []string{"preserve", "react"} {
		for _, form := range []string{"import-type", "reexport", "import-type-node"} {
			for _, quote := range []string{"\"", "'"} {
				name := "double"
				if quote == "'" {
					name = "single"
				}
				rows = append(rows, vibexDeclarationCase{jsx + ":" + form + ":" + name, jsx, form, quote})
			}
		}
	}
	return rows
}

// VIP39 explicitly compares public declarations with this fork's .tsx
// twin. Both projects omit declarationImportStyle: the undecided .vibex
// mapping of its nondefault values is not inferred from current behavior.
func FuzzVibexDeclarationSpelling(f *testing.F) {
	startShortBudget(f)
	rows := vibexDeclarationCases()
	for _, row := range rows {
		f.Add(row.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestVibexDeclarationSpellingQuoted(t)
		index := slices.IndexFunc(rows, func(row vibexDeclarationCase) bool { return row.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rows)
		}
		row := rows[index]
		ending := ".js"
		if row.jsx == "preserve" {
			ending = ".jsx"
		}
		form := map[string]string{
			"import-type":      "import type { T } from %s;\nexport type U=T;\n",
			"reexport":         "export { value } from %s;\n",
			"import-type-node": "export type U=import(%s).T;\n",
		}[row.form]
		leaf := "export type T={readonly n:number};\nexport const value:T={n:1};\n"
		compile := func(main, extension, spec string) *Result {
			config, _ := json.Marshal(map[string]any{
				"compilerOptions": map[string]any{"module": "Preserve", "moduleResolution": "Bundler", "target": "ES2022", "jsx": row.jsx,
					"strict": true, "types": []string{}, "skipLibCheck": true, "declaration": true, "emitDeclarationOnly": true, "outDir": "out", "rootDir": ".",
					"allowArbitraryExtensions": true, "allowImportingTsExtensions": true},
				"files": []string{main, "leaf." + extension},
			})
			var result *Result
			var err error
			within(t, "compile VIP39 declaration twin", func() {
				result, err = w.Compile(t.Context(), Project{
					Files: map[string]string{main: fmt.Sprintf(form, row.quote+spec+row.quote), "leaf." + extension: leaf}, Config: string(config),
				})
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			return result
		}
		native := compile("main.ts", "tsx", "./leaf"+ending)
		if HasError(native.Diagnostics) {
			t.Fatalf("native .tsx control invalid: %v", SortedKeys(Keys(native.Dir, native.Diagnostics)))
		}
		want, ok := native.Outputs["out/main.d.ts"]
		if !ok {
			t.Fatal("native twin did not emit its declaration")
		}
		vibe := compile("main.vibe", "vibex", "./leaf.vibex")
		got, ok := vibe.Outputs["out/main.d.ts"]
		gaps := &Gaps{Target: "FuzzVibexDeclarationSpelling", Input: row.key}
		if HasError(vibe.Diagnostics) || !ok || got != want {
			gaps.Add("declaration:"+row.key, "VIP39 default public .vibex references must match .tsx twin: diagnostics=%v\nvibe=%s\nnative=%s",
				SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)), got, want)
		} else {
			ExpectPending(t, "FuzzVibexDeclarationSpelling", "declaration:"+row.key)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
