package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixRetiredRuntimeFactories(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"mixed-import", `import { yieldNow as pause, $noFailure } from "vibelang-runtime"; export const other: symbol = $noFailure; export const value: Effect.Effect<void> = pause(2)`},
		{"namespace-keep", `import * as Runtime from "vibelang-runtime"; export const marker: symbol = Runtime.$noFailure; export const value: Effect.Effect<void> = Runtime.yieldNow(2)`},
		{"local-shadow", `import { yieldNow as pause } from "vibelang-runtime"; namespace Inner { const pause = 42; export const value = pause }; export const value: Effect.Effect<void> = pause(2)`},
		{"named-priority", `import { yieldNow } from "vibelang-runtime"; export const value: Effect.Effect<void> = yieldNow(2)`},
		{"named-alias", `import { yieldNow as pause } from "vibelang-runtime"; export const value: Effect.Effect<void> = pause(undefined)`},
		{"named-interrupt", `import { interrupt as stop } from "vibelang-runtime"; export const value: Effect.Effect<never> = stop()`},
		{"namespace-priority", `import * as Runtime from "vibelang-runtime"; export const value: Effect.Effect<void> = Runtime.yieldNow(2)`},
		{"namespace-interrupt", `import * as Runtime from "vibelang-runtime"; export const value: Effect.Effect<never> = Runtime.interrupt()`},
		{"held-in-effect", `import { yieldNow as pause } from "vibelang-runtime"; export effect function main(): Effect.Effect<void>!! { return pause(2) }`},
		{"existing-try", `import { interrupt as stop } from "vibelang-runtime"; export effect function main() { try stop() }`},
		{"optional-spread", `import { yieldNow as pause } from "vibelang-runtime"; const args: [number?] = []; export const value: Effect.Effect<void> = pause?.(...args)`},
		{"comments", "import { yieldNow as pause } from \"vibelang-runtime\"; export const value: Effect.Effect<void> = (/* callee */ pause)(/* priority */ 2)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			original, file, _, _ := editorProgram(t, tc.source+"\n")
			dir := filepath.Dir(file.FileName().AsString())
			fs := bundled.WrapFS(osvfs.FS())
			config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errs) > 0 {
				t.Fatal(errs)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) > 0 || fixed == nil {
				var diagnosticText []string
				for _, d := range original.GetSemanticDiagnostics(t.Context(), file) {
					diagnosticText = append(diagnosticText, diagnosticWithNotes(d))
				}
				t.Fatalf("retired runtime factory lacks migration: err=%v refused=%+v diagnostics=%v", result.Err, result.Refused, diagnosticText)
			}
			if strings.Index(fixed.Text, "vibelang-runtime") > strings.Index(fixed.Text, "effect/Effect") {
				t.Fatalf("moved the old dependency after the new native dependency:\n%s", fixed.Text)
			}
			if !strings.Contains(fixed.Text, "effect/Effect") {
				t.Fatalf("missing native Effect import:\n%s", fixed.Text)
			}
			if strings.Contains(fixed.Text, "try ") != (tc.name == "existing-try") {
				t.Fatalf("changed run phase:\n%s", fixed.Text)
			}
			for _, comment := range []string{"/* callee */", "/* priority */"} {
				if strings.Count(tc.source, comment) != strings.Count(fixed.Text, comment) {
					t.Fatalf("lost/duplicated comment %q:\n%s", comment, fixed.Text)
				}
			}
			program, parsed, _, _ := editorProgram(t, fixed.Text)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), parsed) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source rejected: %s\n%s", diagnosticWithNotes(d), fixed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if again.Err != nil || len(again.Files) > 0 || len(again.Refused) > 0 {
				t.Fatalf("not fixed point: %+v", again)
			}
		})
	}
}

func TestRetiredRuntimeFactoryObservationsStayUnchanged(t *testing.T) {
	for _, source := range []string{
		`import { yieldNow as pause } from "vibelang-runtime"; export const escaped = pause; export const value = pause(2)`,
		`import { yieldNow as pause } from "vibelang-runtime"; export const escaped = { pause }; export const value = pause(2)`,
		`import { yieldNow as pause } from "vibelang-runtime"; export { pause }; export const value = pause(2)`,
		`import { yieldNow as pause } from "vibelang-runtime"; export type Factory = typeof pause; export const value = pause(2)`,
		`import * as Runtime from "vibelang-runtime"; export const escaped = Runtime; export const value = Runtime.yieldNow(2)`,
		`import * as Runtime from "vibelang-runtime"; export const value = Runtime["yieldNow"](2)`,
		`import { yieldNow as pause } from "vibelang-runtime"; eval("pause"); export const value = pause(2)`,
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source+"\n")
			fs := bundled.WrapFS(osvfs.FS())
			config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errs) > 0 {
				t.Fatal(errs)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if len(result.Files) > 0 {
				t.Fatalf("changed an observable factory binding: %+v", result)
			}
		})
	}
}

func TestRetiredRuntimeFactoryForeignResolution(t *testing.T) {
	source := `import { yieldNow as pause } from "vibelang-runtime"; export const value: Effect.Effect<void> = pause(2)` + "\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	fake := filepath.Join(dir, "foreign-runtime")
	if err := os.Mkdir(fake, 0700); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{"package.json": `{"name":"foreign-library","types":"index.d.ts"}`, "index.d.ts": "export {};\n"} {
		if err := os.WriteFile(filepath.Join(fake, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	configText := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"baseUrl":".","paths":{"vibelang-runtime":["./foreign-runtime/index.d.ts"]}},"files":["main.vibe"]}`
	configPath := filepath.Join(dir, "tsconfig.json")
	if err := os.WriteFile(configPath, []byte(configText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configPath)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
	if len(result.Files) > 0 {
		t.Fatalf("rewrote a foreign package redirected under the runtime name: %+v", result)
	}
}
