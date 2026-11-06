package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const nativeReferenceExportQuote = "Synthesized import types use TypeScript’s spelling for the twin under the same imports and tsconfig."

func requireNativeReferenceExportQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), nativeReferenceExportQuote) {
		t.Fatal("missing native reference declaration rule")
	}
}

func TestNativeReferenceExportQuoted(t *testing.T) { requireNativeReferenceExportQuote(t) }

func FuzzNativeReferenceExport(f *testing.F) {
	startShortBudget(f)
	requireNativeReferenceExportQuote(f)
	for _, key := range []string{"alchemy-indirect-export", "pattern", "root", "array", "condition", "private", "nested", "declaration-dir"} {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		rule, ok := map[string]string{"alchemy-indirect-export": "exact", "exact": "exact", "pattern": "pattern", "root": "root", "array": "array", "condition": "condition", "private": "private", "nested": "nested", "declaration-dir": "declaration-dir"}[key]
		if !ok {
			return
		}
		ext := []string{".vibe", ".vibex"}[int(variant)%2]
		sourceRedirect := variant&2 != 0
		stem := "Stage"
		if rule == "nested" {
			stem = "nested/Stage"
		}
		output := "lib"
		declOption := ""
		if rule == "declaration-dir" {
			output = "declarations"
			declOption = `,"declarationDir":"declarations"`
		}
		entry := fmt.Sprintf(`"./%s":"./src/%s%s"`, stem, stem, ext)
		specifier := "core/" + stem
		switch rule {
		case "pattern":
			entry = fmt.Sprintf(`"./*":"./src/*%s"`, ext)
		case "root":
			entry = fmt.Sprintf(`".":"./src/%s%s"`, stem, ext)
			specifier = "core"
		case "array":
			entry = fmt.Sprintf(`"./%s":["./src/%s%s"]`, stem, stem, ext)
		case "condition":
			entry = fmt.Sprintf(`"./%s":{"default":"./src/%s%s"}`, stem, stem, ext)
		case "private":
			entry = `"./unrelated":"./src/unrelated.ts"`
		}
		files := map[string]any{
			"/app/package.json":                      `{"type":"module"}`,
			"/app/tsconfig.json":                     `{"compilerOptions":{"target":"es2022","strict":true,"module":"preserve","moduleResolution":"bundler","jsx":"preserve","declaration":true,"outDir":"out","types":[]},"vibe":{"effectGlobals":false,"effectModules":false},"files":["main.ts"],"references":[{"path":"../core"}]}`,
			"/app/main.ts":                           `import { make } from "core/api"; export const result = make();`,
			"/app/node_modules/core":                 vfstest.Symlink("/core"),
			"/core/package.json":                     fmt.Sprintf(`{"name":"core","type":"module","exports":{"./api":"./src/api.ts",%s}}`, entry),
			"/core/tsconfig.json":                    fmt.Sprintf(`{"compilerOptions":{"target":"es2022","strict":true,"module":"preserve","moduleResolution":"bundler","composite":true,"rootDir":"src","outDir":"lib","jsx":"preserve","types":[]%s},"vibe":{"effectGlobals":false,"effectModules":false},"include":["src"]}`, declOption),
			"/core/src/api.ts":                       fmt.Sprintf(`import { Stage } from "./%s.js"; export const make = () => new Stage();`, stem),
			"/core/src/" + stem + ext:                `export class Stage { private marker = 1; }`,
			"/core/" + output + "/api.d.ts":          fmt.Sprintf(`import { Stage } from "./%s.ts"; export declare const make: () => Stage;`, stem),
			"/core/" + output + "/" + stem + ".d.ts": `export declare class Stage { private marker; }`,
		}
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		cfg, ds := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(ds) != 0 {
			t.Fatal(ds)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: cfg, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil), UseSourceOfProjectReference: sourceRedirect})
		outputText := ""
		result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
			if strings.HasSuffix(name.AsString(), "main.d.ts") {
				outputText = text
			}
			return nil
		}})
		gapKey := fmt.Sprintf("%s/%s/source=%t", key, ext, sourceRedirect)
		hasPortableError := false
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				if d.Code() == 2883 {
					hasPortableError = true
				} else {
					Gap(t, "FuzzNativeReferenceExport", gapKey, "declaration diagnostic TS%d: %v", d.Code(), d)
				}
			}
		}
		if rule == "private" {
			if !hasPortableError {
				Gap(t, "FuzzNativeReferenceExport", gapKey, "private module became publicly nameable: %s", outputText)
			}
			return
		}
		if hasPortableError {
			Gap(t, "FuzzNativeReferenceExport", gapKey, "public referenced native type is not nameable")
		}
		want := fmt.Sprintf(`import(%q).Stage`, specifier)
		if !strings.Contains(outputText, want) {
			Gap(t, "FuzzNativeReferenceExport", gapKey, "wanted %s, got %s", want, outputText)
		}
	})
}
