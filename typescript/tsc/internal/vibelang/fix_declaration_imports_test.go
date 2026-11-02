package vibelang

import (
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

// declarationImports returns the import lines of main.d.ts, which the
// project of config emits.
func declarationImports(t *testing.T, config string) string {
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
	var imports []string
	for line := range strings.Lines(dts) {
		if strings.HasPrefix(line, "import ") {
			imports = append(imports, strings.TrimSpace(line))
		}
	}
	return strings.Join(imports, "\n")
}
