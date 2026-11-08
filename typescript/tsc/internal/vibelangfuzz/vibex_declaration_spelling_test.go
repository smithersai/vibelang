package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// vibexDeclarationSpecifierQuote is VIP-39's 2026-11-03 amendment, repeated in
// chapter 1's Declaration output: the twin of a written ./leaf.vibex writes
// ./leaf.tsx, and a written JavaScript spelling stays as written.
const vibexDeclarationSpecifierQuote = "Ordinary package declarations use the native twin\u2019s relative specifiers: \x60./user.vibe\x60 is declared as \x60./user.ts\x60 and \x60./App.vibex\x60 as \x60./App.tsx\x60; written \x60./user.js\x60, \x60./App.jsx\x60, \x60./user\x60 and native \x60./plain.ts\x60 keep their spelling."

func TestVibexDeclarationSpellingQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), "The emitted declaration may add exactly the generated `@throws {never}` contract where the twin has no authored throw contract.") {
		t.Fatal("missing generated contract identity rule")
	}

	const quote = "The public \x60x.d.ts\x60 is API-identical ([VIP-27](0027-declaration-output.md)) to the one the fork writes for the unmodified \x60.tsx\x60 twin, with VIP-27's one generated-contract exception: the emitted declaration may add a generated \x60@throws {never}\x60 where the twin has no authored throw contract."
	if !strings.Contains(SpecText("../vips/0039-vibex.md"), quote) {
		t.Fatalf("VIP39 no longer says %q", quote)
	}
	for _, chapter := range []string{"../vips/0039-vibex.md", "001-functions.md"} {
		if !strings.Contains(SpecText(chapter), vibexDeclarationSpecifierQuote) {
			t.Fatalf("%s no longer says %q", chapter, vibexDeclarationSpecifierQuote)
		}
	}
}

// written is how main spells the .vibex module: "vibex" writes ./leaf.vibex,
// whose twin writes ./leaf.tsx; "js" writes the JavaScript output name, which
// both keep (keys without a written suffix are the "vibex" rows).
type vibexDeclarationCase struct{ key, jsx, form, quote, written string }

func vibexDeclarationCases() []vibexDeclarationCase {
	var rows []vibexDeclarationCase
	for _, jsx := range []string{"preserve", "react"} {
		for _, form := range []string{"import-type", "reexport", "import-type-node", "inferred", "inferred-call", "export-star-as"} {
			for _, quote := range []string{"\"", "'"} {
				name := "double"
				if quote == "'" {
					name = "single"
				}
				rows = append(rows, vibexDeclarationCase{jsx + ":" + form + ":" + name, jsx, form, quote, "vibex"})
				if form != "inferred-call" {
					rows = append(rows, vibexDeclarationCase{jsx + ":" + form + ":" + name + ":js", jsx, form, quote, "js"})
				}
			}
		}
	}
	return rows
}

// VIP39 explicitly compares public declarations with this fork's .tsx
// twin, whose specifiers it amended on 2026-11-03
// (vibexDeclarationSpecifierQuote). Both projects omit declarationImportStyle.
// Chapter 007 / explicit vibex source and declaration resolution follows TSX: docs/design/src/007-tooling.md#5fd2918efd46b2f8
// Chapter 007 / default vibex declarations use the native JSX output name: docs/design/src/007-tooling.md#13acd5d5e7019188
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
			"inferred":         "import { value } from %s;\nexport const get=()=>value;\n",
			"inferred-call":    "import { value } from %s;\nexport const get=(increment:number)=>({n:value.n+increment});\n",
			"export-star-as":   "export * as leaf from %s;\n",
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
		twin, written := "./leaf.tsx", "./leaf.vibex"
		if row.written == "js" {
			twin, written = "./leaf"+ending, "./leaf"+ending
		}
		native := compile("main.ts", "tsx", twin)
		if HasError(native.Diagnostics) {
			t.Fatalf("native .tsx control invalid: %v", SortedKeys(Keys(native.Dir, native.Diagnostics)))
		}
		want, ok := native.Outputs["out/main.d.ts"]
		if !ok {
			t.Fatal("native twin did not emit its declaration")
		}
		vibe := compile("main.vibe", "vibex", written)
		got, ok := vibe.Outputs["out/main.d.ts"]
		gaps := &Gaps{Target: "FuzzVibexDeclarationSpelling", Input: row.key}
		// VIP-27 permits exactly the generated never contract. Retain a
		// separate strict spelling check because API identity intentionally
		// permits equivalent native import spellings.
		specifiersEqual := slices.Equal(vibexDeclarationSpecifiers(want), vibexDeclarationSpecifiers(got))
		identityEqual := got == want
		if !identityEqual && specifiersEqual && !HasError(vibe.Diagnostics) && ok {
			identityEqual = compareDeclarationOutputs(t, native.Outputs, vibe.Outputs) == ""
		}
		if HasError(vibe.Diagnostics) || !ok || !specifiersEqual || !identityEqual {
			gaps.Add("declaration:"+row.key, "VIP39: %s\ndiagnostics=%v\nvibe=%s\nnative=%s", vibexDeclarationSpecifierQuote,
				SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)), got, want)
		} else {
			ExpectPending(t, "FuzzVibexDeclarationSpelling", "declaration:"+row.key)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}

// Match module specifiers in import declarations, exports and import types,
// which are the declaration forms varied by this generator.
var vibexDeclarationSpecifierPattern = regexp.MustCompile(`(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']`)

func vibexDeclarationSpecifiers(text string) []string {
	var result []string
	for _, match := range vibexDeclarationSpecifierPattern.FindAllStringSubmatch(text, -1) {
		result = append(result, match[1])
	}
	return result
}
func TestVibexDeclarationSpecifierGuard(t *testing.T) {
	native := `export declare const get: () => import("./leaf.tsx").T;`
	generated := "/** @throws {never} */" + native
	if !slices.Equal(vibexDeclarationSpecifiers(native), vibexDeclarationSpecifiers(generated)) {
		t.Fatal("generated contract changed a module path")
	}
	for _, bad := range []string{"./leaf.js", "./leaf.jsx", "./leaf.vibex", "./leaf.ts"} {
		changed := strings.Replace(generated, "./leaf.tsx", bad, 1)
		if slices.Equal(vibexDeclarationSpecifiers(native), vibexDeclarationSpecifiers(changed)) {
			t.Fatalf("wrong written module spelling escaped: %s", bad)
		}
	}
}
func TestVibexGeneratedContractIdentity(t *testing.T) {
	native := map[string]string{"out/main.d.ts": "export declare const get: () => number;"}
	generated := map[string]string{"out/main.d.ts": "/** @throws {never} */\nexport declare const get: () => number;"}
	if diff := compareDeclarationOutputs(t, native, generated); diff != "" {
		t.Fatal(diff)
	}
	for _, bad := range []string{"/** @throws {unknown} */\nexport declare const get: () => number;", "/** @throws {never} */\nexport declare const get: () => string;", "/** changed docs */\nexport declare const get: () => number;"} {
		if compareDeclarationOutputs(t, native, map[string]string{"out/main.d.ts": bad}) == "" {
			t.Fatal("changed throw contract, type or documentation escaped identity")
		}
	}
}
