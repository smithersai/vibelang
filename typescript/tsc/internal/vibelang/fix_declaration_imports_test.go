package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// When a fix leaves an effect import unused in code, vibelang --fix removes
// it only if the declaration file does not print it (D501), as the prelude
// rewrites decide (fix_prelude.go). EK2128's fix turns Effect.fn(…)(function*
// …) into an effect arrow, so no code names Effect, but the export's type is
// still Effect.Effect: the declaration printed import * as Effect from
// "effect/Effect" before the fix and must after it, not import { Effect }
// from "effect" (t3code apps/server AgentDeviceShim, drive-t3code-server
// 12:03Z, refused by the migrate flow's declaration identity gate).
func TestFixKeepsEffectImportsTheDeclarationPrints(t *testing.T) {
	for _, test := range []struct{ name, source, keep, gone string }{
		{"Effect.fn", `import * as Effect from "effect/Effect"

export const ensure = Effect.fn("ensure")(function* (n: number) {
  return n + 1
})
`, `import * as Effect from "effect/Effect"`, "function*"},
		{"Effect.gen", `import * as Effect from "effect/Effect"

export const two = () => Effect.gen(function* () {
  return 2
})
`, `import * as Effect from "effect/Effect"`, "function*"},
		// EK4831's fix writes service, which no longer names Context, while
		// the declaration's class still extends Context's service
		// (ThreadMetadataMcpService).
		{"Context.Service", `import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

export class Updates extends Context.Service<
  Updates,
  {
    readonly update: (id: string) => Effect.Effect<number, Error>
  }
>()("t3/Updates") {}
`, `import * as Context from "effect/Context"`, "Context.Service"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, test.source)
			dir := filepath.Dir(file.FileName().AsString())
			config := filepath.Join(dir, "tsconfig.json")
			if err := os.WriteFile(config, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`), 0o600); err != nil {
				t.Fatal(err)
			}
			before := declarationImports(t, config)
			if !strings.Contains(before, test.keep) {
				t.Fatalf("the original's declaration imports\n%s\nlack %s", before, test.keep)
			}
			fs := bundled.WrapFS(osvfs.FS())
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			result := FixProject(t.Context(), fs, bundled.LibPath(), parsed)
			fixed := result.Files[file.FileName()]
			if fixed == nil || strings.Contains(fixed.Text, test.gone) {
				t.Fatalf("--fix did not rewrite %s: %+v refused %+v", test.gone, fixed, result.Refused)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0o600); err != nil {
				t.Fatal(err)
			}
			if after := declarationImports(t, config); after != before {
				t.Fatalf("--fix wrote\n%s\nwhose declaration imports\n%s\nwere\n%s", fixed.Text, after, before)
			}
		})
	}
}

// An Effect.fn's declaration prints its inferred parameter tuple, and the
// effect function --fix writes must print the same text: t3code's
// effect-codex-app-server client, ssh auth and client-runtime session each
// have a defaulted parameter, which tsc prints o?: T | undefined and an
// effect arrow with o: T = {} printed o?: T (drive-t3code 21:14Z). Each row
// is one parameter list, with and without exactOptionalPropertyTypes. A
// destructured parameter stays out: tsc names its tuple element args_0, a name
// --fix cannot write, and the two declarations have the same type.
func TestFixedEffectFnParametersKeepTheOriginalDeclaration(t *testing.T) {
	const options = `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"`
	for _, parameters := range []string{
		`o: { readonly x?: number } = {}`,
		`o: Options = {}`,
		`o: Options | undefined = {}`,
		`o: Options = {}, ...rest: ReadonlyArray<string>`,
		`a: string, o: number = 1`,
		`o: number = 1, a?: string`,
		`o?: Options`,
		`o: () => number = () => 1`,
		`o: number | string = 1`,
	} {
		for _, exact := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s exact=%t", parameters, exact), func(t *testing.T) {
				source := "import * as Effect from \"effect/Effect\"\n\nexport interface Options {\n  readonly x?: number\n}\n\n" +
					"export const traced = Effect.fn(\"traced\")(function* (" + parameters + ") {\n  return 1\n})\n\n" +
					"export const untraced = Effect.fnUntraced(function* (" + parameters + ") {\n  return 2\n})\n"
				_, file, _, _ := editorProgram(t, source)
				dir := filepath.Dir(file.FileName().AsString())
				config := filepath.Join(dir, "tsconfig.json")
				project := func(name string) {
					text := `{"compilerOptions":` + options + fmt.Sprintf(`,"exactOptionalPropertyTypes":%t},"files":[%q]}`, exact, name)
					if err := os.WriteFile(config, []byte(text), 0o600); err != nil {
						t.Fatal(err)
					}
				}
				// The original is the TypeScript: in a .vibe file function* is a producer.
				twin := filepath.Join(dir, "main.ts")
				if err := os.WriteFile(twin, []byte(source), 0o600); err != nil {
					t.Fatal(err)
				}
				project("main.ts")
				before := declarationText(t, config)
				if err := os.Remove(twin); err != nil {
					t.Fatal(err)
				}
				project("main.vibe")
				fs := bundled.WrapFS(osvfs.FS())
				parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config)), &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 {
					t.Fatalf("config: %v", errors)
				}
				fixed := FixProject(t.Context(), fs, bundled.LibPath(), parsed)
				rewritten := fixed.Files[file.FileName()]
				if rewritten == nil || strings.Contains(rewritten.Text, "function*") {
					t.Fatalf("--fix did not rewrite the generators: %+v refused %+v", rewritten, fixed.Refused)
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(rewritten.Text), 0o600); err != nil {
					t.Fatal(err)
				}
				if after := declarationText(t, config); after != before {
					t.Fatalf("--fix wrote\n%s\nwhose declaration\n%s\nwas\n%s", rewritten.Text, after, before)
				}
			})
		}
	}
}

// declarationImports returns the import lines of main.d.ts, which the
// project of config emits.
func declarationImports(t *testing.T, config string) string {
	t.Helper()
	dts := declarationText(t, config)
	var imports []string
	for line := range strings.Lines(dts) {
		if strings.HasPrefix(line, "import ") {
			imports = append(imports, strings.TrimSpace(line))
		}
	}
	return strings.Join(imports, "\n")
}

// declarationText returns the main.d.ts that the project of config emits.
func declarationText(t *testing.T, config string) string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	var dts string
	p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.d.ts") {
			dts = text
		}
		return nil
	}})
	if dts == "" {
		t.Fatal("no main.d.ts emitted")
	}
	return dts
}
