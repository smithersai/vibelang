package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"
)

const nativeImporterQuote = "Declarations are API-identical to `tsc`'s for the Effect TypeScript twin"
const nativeImporterTarget = "FuzzDeclarationNativeImporter"

var nativeImporterKeys = []string{"ts-importer", "tsx-importer", "vibe-importer", "ts-control"}
var nativeImporterProvider = regexp.MustCompile(`import\(["']([^"']+)["']\)\.Providers`)

func TestDeclarationNativeImporterQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), nativeImporterQuote) {
		t.Fatalf("VIP-27 no longer says %q", nativeImporterQuote)
	}
}

func nativeImporterProject(key string, variant byte, twin bool) (Project, string) {
	provider, index, rule, consumer := "ts", "ts", "vibe", "ts"
	if variant&1 != 0 {
		provider = "vibe"
	}
	if variant&2 != 0 {
		index = "vibe"
	}
	if key == "tsx-importer" {
		consumer = "tsx"
	}
	if key == "vibe-importer" {
		consumer = "vibe"
	}
	if key == "ts-control" {
		rule = "ts"
	}
	if twin {
		provider, index, rule = "ts", "ts", "ts"
		if consumer == "vibe" {
			consumer = "ts"
		}
	}
	dir, up := "sub/", "../"
	if variant&8 != 0 {
		dir += "nested/"
		up += "../"
	}
	reexport := fmt.Sprintf("export * from \"./Providers.%s\";\n", provider)
	if variant&4 != 0 {
		reexport = fmt.Sprintf("export type { Providers } from \"./Providers.%s\";\n", provider)
	}
	files := map[string]string{
		"package.json":                       servicesPackage,
		"src/Providers." + provider:          "export interface Providers { readonly region: string }\n",
		"src/index." + index:                 reexport + fmt.Sprintf("export * from \"./Rule.%s\";\n", rule),
		"src/Rule." + rule:                   fmt.Sprintf("import * as Effect from \"effect/Effect\";\nimport type { Providers } from \"./Providers.%s\";\nexport declare const rule: () => Effect.Effect<number, never, Providers>;\n", provider),
		"src/" + dir + "ToQueue." + consumer: fmt.Sprintf("import { rule } from \"%sRule.%s\";\nexport const toQueue = () => rule();\n", up, rule),
	}
	for name, source := range files {
		if name == "package.json" {
			continue
		}
		if variant&16 != 0 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		if variant&32 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		files[name] = source
	}
	cfg, _ := json.Marshal(map[string]any{
		"compilerOptions": map[string]any{"target": "esnext", "module": "preserve", "moduleResolution": "bundler", "jsx": "preserve", "strict": true, "skipLibCheck": true, "types": []string{}, "declaration": true, "emitDeclarationOnly": true, "outDir": "out", "rootDir": "src", "allowImportingTsExtensions": true, "rewriteRelativeImportExtensions": true},
		"include":         []string{"src/**/*"},
	})
	return Project{Files: files, Config: string(cfg)}, "out/" + dir + "ToQueue.d.ts"
}

func nativeImporterModule(t *testing.T, declaration string) string {
	t.Helper()
	m := nativeImporterProvider.FindStringSubmatch(declaration)
	if m == nil {
		t.Fatalf("no inferred Providers module in declaration:\n%s", declaration)
	}
	name := m[1]
	for _, ext := range []string{".ts", ".js", ".vibe"} {
		name = strings.TrimSuffix(name, ext)
	}
	return name
}

func FuzzDeclarationNativeImporter(f *testing.F) {
	startShortBudget(f)
	for _, key := range nativeImporterKeys {
		f.Add(key, byte(0))
		f.Add(key, byte(63))
	}
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestDeclarationNativeImporterQuoted(t)
		if !slices.Contains(nativeImporterKeys, key) {
			key = nativeImporterKeys[int(variant)%len(nativeImporterKeys)]
		}
		source, name := nativeImporterProject(key, variant, false)
		twin, _ := nativeImporterProject(key, variant, true)
		got, err := w.Compile(t.Context(), source)
		if err != nil {
			t.Fatal(err)
		}
		if HasError(got.Diagnostics) {
			t.Fatalf("invalid native-import project: %v", SortedKeys(Keys(got.Dir, got.Diagnostics)))
		}
		want := stockDeclaration(t, w, tsc, twin, name)
		actualModule, wantModule := nativeImporterModule(t, got.Outputs[name]), nativeImporterModule(t, want)
		if actualModule != wantModule {
			Gap(t, nativeImporterTarget, key, "VIP-27: %s; importer=%s variant=%d declared %q, stock twin %q\n%s", nativeImporterQuote, key, variant, actualModule, wantModule, got.Outputs[name])
		}
		ExpectPending(t, nativeImporterTarget, key)
	})
}
