package vibelangfuzz

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"testing"
)

const unrelatedDeclarationQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestUnrelatedDeclarationSpecifierQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), unrelatedDeclarationQuote) {
		t.Fatal(unrelatedDeclarationQuote)
	}
}

// Migrating the bridge without changing its native importer preserves its
// declaration bytes. An explicit source import additionally follows the
// corresponding native .ts input's import-ending preference (VIP-27).
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

// Exercise native spelling signals and import order around an unrelated migration.
// Saved archives remain the mutation input, with repository/pattern corpus names.
func unrelatedDeclarationStyleSeeds() []string {
	var seeds []string
	for _, ext := range []string{".ts", ".tsx"} {
		for _, ending := range []string{"", ".ts", ".js"} {
			files := Unarchive(unrelatedDeclarationSeed(ext, "", `"`, true))
			if ending != "" {
				// .js resolves to the actual .ts/.tsx module. A source suffix must
				// match that module's kind.
				spelling := ending
				if ending == ".ts" {
					spelling = ext
				}
				files["main"+ext] = strings.Replace(files["main"+ext], `"./banners"`, `"./banners`+spelling+`"`, 1)
				files["banners"+ext] = strings.Replace(files["banners"+ext], `"./view"`, `"./view`+spelling+`"`, 1)
			}
			seeds = append(seeds, Archive(files))
			// The migrated import is last, so native preferences must not
			// depend on whether it precedes the unchanged native import.
			lines := strings.Split(files["main"+ext], "\n")
			lines[0], lines[1] = lines[1], lines[0]
			files["main"+ext] = strings.Join(lines, "\n")
			seeds = append(seeds, Archive(files))
		}
	}
	return seeds
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
	for _, seed := range unrelatedDeclarationStyleSeeds() {
		f.Add(seed)
	}
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
		output := "out/main.d.ts"
		original, ok := before.Outputs[output]
		if !ok || original == "" {
			t.Fatal("missing native declaration")
		}
		for _, explicit := range []bool{false, true} {
			migrated := maps.Clone(files)
			migrated["bridge.vibe"] = migrated["bridge.ts"]
			delete(migrated, "bridge.ts")
			want := original
			if explicit {
				migrated[main] = strings.ReplaceAll(strings.ReplaceAll(text, `"./bridge"`, `"./bridge.vibe"`), "'./bridge'", "'./bridge.vibe'")
				nativeFiles := maps.Clone(files)
				nativeFiles[main] = strings.ReplaceAll(strings.ReplaceAll(text, `"./bridge"`, `"./bridge.ts"`), "'./bridge'", "'./bridge.ts'")
				twin, err := w.Compile(t.Context(), Project{Files: nativeFiles, Config: cfg})
				if err != nil {
					t.Fatal(err)
				}
				if HasError(twin.Diagnostics) {
					t.Fatalf("native source-import twin: %v", SortedKeys(Keys(twin.Dir, twin.Diagnostics)))
				}
				want = twin.Outputs[output]
				twin.Remove()
			}
			after, err := w.Compile(t.Context(), Project{Files: migrated, Config: cfg})
			if err != nil {
				t.Fatal(err)
			}
			if HasError(after.Diagnostics) {
				t.Fatalf("one-file migration: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
			}
			got := after.Outputs[output]
			after.Remove()
			key := fmt.Sprintf("raw:%x", sha256.Sum256([]byte(archive)))
			if got == "" || got != want {
				Gap(t, "FuzzUnrelatedDeclarationSpecifier", key, "%s: explicit=%t; native:\n%s\nmigrated:\n%s\n%s", unrelatedDeclarationQuote, explicit, want, got, archive)
			}
		}
		ExpectPending(t, "FuzzUnrelatedDeclarationSpecifier", fmt.Sprintf("raw:%x", sha256.Sum256([]byte(archive))))
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
	seeds = append(seeds, unrelatedDeclarationStyleSeeds()...)
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
