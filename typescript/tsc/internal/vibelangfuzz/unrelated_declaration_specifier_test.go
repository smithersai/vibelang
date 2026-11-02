package vibelangfuzz

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const unrelatedDeclarationQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestUnrelatedDeclarationSpecifierQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), unrelatedDeclarationQuote) {
		t.Fatal(unrelatedDeclarationQuote)
	}
}

// T3code's migration changes bridge.ts alone. The untouched native importer
// infers a type from a different TSX module. Neither the unrelated import nor
// the project containing one VibeLang source may respell that inferred type.
// Compare raw declarations from the native project and its one-file migration;
// no declaration canonicalizer is allowed to hide a changed import specifier.
func unrelatedDeclarationSeed(ext, prefix, quote string, conditional bool) string {
	result := "item()"
	if conditional {
		result = "flag ? item() : null"
	}
	return Archive(map[string]string{
		"bridge.ts":              "export function use(value: number): number { return value; }\n",
		prefix + "view" + ext:    "export interface View { readonly id: string; readonly icon: string | null; readonly title: string; }\n",
		prefix + "banners" + ext: "import type { View } from " + quote + "./view" + quote + ";\nexport declare function item(input?: { readonly tasks: readonly string[] }): View;\n",
		"main" + ext:             "import { use } from " + quote + "./bridge" + quote + ";\nimport { item } from " + quote + "./" + prefix + "banners" + quote + ";\nexport interface Input { readonly tasks: Parameters<typeof item>[0]; }\nexport function run(flag: boolean) { use(1); return { now: " + result + " }; }\n",
	})
}

// A written type import is an independent positive control: the declaration
// already names View and needs no compiler-generated import-type specifier.
func unrelatedDeclarationAnnotatedSeed(ext string) string {
	files := Unarchive(unrelatedDeclarationSeed(ext, "", `"`, true))
	name := "main" + ext
	files[name] = "import type { View } from \"./view\";\n" + strings.Replace(files[name], "run(flag: boolean) {", "run(flag: boolean): { now: View | null } {", 1)
	return Archive(files)
}

func FuzzUnrelatedDeclarationSpecifier(f *testing.F) {
	startShortBudget(f)
	for _, ext := range []string{".ts", ".tsx"} {
		for _, prefix := range []string{"", "nested/"} {
			for _, quote := range []string{`"`, `'`} {
				f.Add(unrelatedDeclarationSeed(ext, prefix, quote, true))
			}
		}
	}
	f.Add(unrelatedDeclarationSeed(".tsx", "", `"`, false))
	f.Add(unrelatedDeclarationAnnotatedSeed(".ts"))
	f.Add(unrelatedDeclarationAnnotatedSeed(".tsx"))
	for _, args := range CorpusInputs("FuzzUnrelatedDeclarationSpecifier") {
		if len(args) == 1 {
			f.Add(args[0])
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, archive string) {
		TestUnrelatedDeclarationSpecifierQuoted(t)
		files := Unarchive(archive)
		if len(files) != 4 || files["bridge.ts"] == "" {
			return
		}
		main := "main.tsx"
		if files[main] == "" {
			main = "main.ts"
		}
		text := files[main]
		if text == "" || (!strings.Contains(text, `"./bridge"`) && !strings.Contains(text, `'./bridge'`)) {
			return
		}
		cfg := unrelatedDeclarationConfig(t)
		before, err := w.Compile(t.Context(), Project{Files: files, Config: cfg})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			// Mutations must still describe an admitted native program.
			t.Skipf("inadmissible native reference: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		files["bridge.vibe"] = files["bridge.ts"]
		delete(files, "bridge.ts")
		files[main] = strings.ReplaceAll(strings.ReplaceAll(text, `"./bridge"`, `"./bridge.vibe"`), `'./bridge'`, `'./bridge.vibe'`)
		after, err := w.Compile(t.Context(), Project{Files: files, Config: cfg})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if HasError(after.Diagnostics) {
			t.Fatalf("unrelated one-file migration rejected: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
		output := "out/main.d.ts"
		want, ok := before.Outputs[output]
		if !ok || want == "" {
			t.Fatalf("missing native declaration: %v", before.Outputs)
		}
		got, ok := after.Outputs[output]
		if !ok || got == "" {
			t.Fatalf("missing migrated declaration: %v", after.Outputs)
		}
		key := fmt.Sprintf("raw:%x", sha256.Sum256([]byte(archive)))
		if got != want {
			Gap(t, "FuzzUnrelatedDeclarationSpecifier", key, "VIP-27 %q\nnative:\n%s\none unrelated migration:\n%s\n%s", unrelatedDeclarationQuote, want, got, archive)
		}
		ExpectPending(t, "FuzzUnrelatedDeclarationSpecifier", key)
		ExpectPending(t, "FuzzUnrelatedDeclarationSpecifier", specCorpusKey(t))
	})
}

func unrelatedDeclarationConfig(t testing.TB) string {
	t.Helper()
	var config map[string]any
	if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
		t.Fatal(err)
	}
	options := config["compilerOptions"].(map[string]any)
	options["module"] = "ESNext"
	options["moduleResolution"] = "Bundler"
	options["jsx"] = "preserve"
	options["rewriteRelativeImportExtensions"] = true
	config["vibe"] = map[string]any{"effectGlobals": false, "effectModules": false}
	cfg, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	return string(cfg)
}

// Every retained neighbourhood seed must be an admitted native program.
// This is separate from fuzz mutation filtering and pending-gap bookkeeping.
func TestUnrelatedDeclarationNativeControls(t *testing.T) {
	w := NewWorkspace(t)
	var seeds []string
	for _, ext := range []string{".ts", ".tsx"} {
		for _, prefix := range []string{"", "nested/"} {
			for _, quote := range []string{`"`, `'`} {
				seeds = append(seeds, unrelatedDeclarationSeed(ext, prefix, quote, true))
			}
		}
	}
	seeds = append(seeds, unrelatedDeclarationSeed(".tsx", "", `"`, false), unrelatedDeclarationAnnotatedSeed(".ts"), unrelatedDeclarationAnnotatedSeed(".tsx"))
	for _, args := range CorpusInputs("FuzzUnrelatedDeclarationSpecifier") {
		if len(args) == 1 {
			seeds = append(seeds, args[0])
		}
	}
	for n, archive := range seeds {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			result, err := w.Compile(t.Context(), Project{Files: Unarchive(archive), Config: unrelatedDeclarationConfig(t)})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				t.Fatalf("invalid native seed: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
			}
			if !strings.Contains(result.Outputs["out/main.d.ts"], ".View") && !strings.Contains(result.Outputs["out/main.d.ts"], "now: View") {
				t.Fatalf("native seed must expose the inferred named View: %s", result.Outputs["out/main.d.ts"])
			}
		})
	}
}
