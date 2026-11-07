package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const importExtensionHintTarget = "FuzzImportExtensionHint"
const importExtensionHintQuote = "Module resolution is as in TypeScript, with `.vibe` and `.vibex` beside `.ts` and `.tsx`"

func TestImportExtensionHintQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), importExtensionHintQuote) {
		t.Fatalf("chapter 7 no longer says %q", importExtensionHintQuote)
	}
}

type importExtensionDiagnostic struct {
	code    int32
	message string
}

// Compare VibeLang sources with their native TypeScript twins, as chapter 7
// requires. Both use the same NodeNext package and extensionless specifier.
func importExtensionDiagnostics(t *testing.T, key string, variant uint16, native, repaired bool) []importExtensionDiagnostic {
	t.Helper()
	ext := "." + key
	if native {
		ext = map[string]string{"vibe": ".ts", "vibex": ".tsx"}[key]
	}
	jsx := "react-jsx"
	if variant&1 == 0 {
		jsx = "preserve"
	}
	main := "main" + []string{".vibe", ".vibex", ".ts"}[int((variant>>1)&3)%3]
	if native {
		main = "main.ts"
	}
	stem := []string{"user", "nested/user", "space dir/value", "café"}[int(variant>>5)%4]
	specifier := "./" + stem
	if variant&128 != 0 {
		specifier = "./missing"
	}
	if repaired {
		specifier += ".js"
		if key == "vibex" && jsx == "preserve" {
			specifier = strings.TrimSuffix(specifier, ".js") + ".jsx"
		}
	}
	form := int(variant>>3) % 4
	source := []string{
		fmt.Sprintf("import { value } from %q\nexport const n: number = value\n", specifier),
		fmt.Sprintf("export { value } from %q\n", specifier),
		fmt.Sprintf("import type { Item } from %q\nexport type Found = Item\n", specifier),
		fmt.Sprintf("export const pending = import(%q)\n", specifier),
	}[form]
	configText, err := json.Marshal(map[string]any{
		"compilerOptions": map[string]any{
			"noEmit": true, "types": []string{}, "target": "ES2022",
			"module": "NodeNext", "jsx": jsx, "skipLibCheck": true,
			"lib": []string{"ES2022"},
		},
		"vibe":  map[string]any{"effectGlobals": false, "effectModules": false},
		"files": []string{main},
	})
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]any{
		"/case/package.json":  "{\"type\":\"module\"}",
		"/case/tsconfig.json": string(configText),
		"/case/" + main:       source,
		"/case/" + stem + ext: "export const value = 1\nexport type Item = number\n",
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromNormalized("/case/tsconfig.json"), &core.CompilerOptions{}, nil, fs, nil)
	if config == nil || len(ds) != 0 || len(config.Errors) != 0 {
		t.Fatalf("invalid oracle configuration: %v %v", config, ds)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{
		Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
		SingleThreaded: core.BoolToTristate(true),
	})
	var got []importExtensionDiagnostic
	ds = p.GetConfigFileParsingDiagnostics()
	ds = append(ds, p.GetSyntacticDiagnostics(t.Context(), nil)...)
	ds = append(ds, p.GetProgramDiagnostics()...)
	ds = append(ds, p.GetGlobalDiagnostics(t.Context())...)
	ds = append(ds, p.GetSemanticDiagnostics(t.Context(), nil)...)
	for _, d := range compiler.SortAndDeduplicateDiagnostics(ds) {
		got = append(got, importExtensionDiagnostic{d.Code(), d.String()})
	}
	return got
}

func FuzzImportExtensionHint(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"vibe", "vibex"} {
		for _, variant := range []uint16{0, 1, 2, 3, 4, 5, 8, 16, 24, 32, 64, 96, 128, 129, 160, 224} {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint16) {
		TestImportExtensionHintQuoted(t)
		if key != "vibe" && key != "vibex" {
			key = []string{"vibe", "vibex"}[variant%2]
		}
		variant &= 255
		label := fmt.Sprintf("%s:jsx-%d:importer-%d:form-%d:path-%d:missing-%t",
			key, variant&1, ((variant>>1)&3)%3, (variant>>3)%4, (variant>>5)%4, variant&128 != 0)
		got := importExtensionDiagnostics(t, key, variant, false, false)
		want := importExtensionDiagnostics(t, key, variant, true, false)
		if !slices.Equal(got, want) {
			Gap(t, importExtensionHintTarget, label+":parity", "%s\nVibeLang: %v\nTypeScript: %v", importExtensionHintQuote, got, want)
			return
		}
		code := int32(2835)
		if variant&128 != 0 {
			code = 2834
		}
		if len(got) != 1 || got[0].code != code {
			Gap(t, importExtensionHintTarget, label+":diagnostic", "expected TS%d, got %v", code, got)
			return
		}
		if variant&128 == 0 {
			if repaired := importExtensionDiagnostics(t, key, variant, false, true); len(repaired) != 0 {
				Gap(t, importExtensionHintTarget, label+":repair", "%s: the runtime spelling still reports %v", importExtensionHintQuote, repaired)
			}
		}
	})
}
