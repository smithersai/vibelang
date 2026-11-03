package vibelang

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixDataMethods(t *testing.T) {
	for _, tt := range []struct{ name, source, want string }{
		{"chain", "export const value = Option.some(1).map((n) => n + 1).getOrElse(() => 0)", "Option.getOrElse(Option.map(Option.some(1)"},
		{"comments", "export const value = Option.some(1) /* receiver */ . /* dot */ map /* name */ (/* argument */ (n) => n + 1)", "Option.map(Option.some(1)"},
		{"alias", "import * as O from \"effect/Option\"; const Option = 42; export const value = O.some(1).map((n) => n + 1)", "O.map(O.some(1)"},
		{"factory alias", "import * as O from \"effect/Option\"; const Option = 42; function subject() { return O.some(1) }; export const value = subject().map((n) => n + 1)", "O.map(subject()"},
		{"no arguments", "export const value = Option.some(1).isSome()", "Option.isSome(Option.some(1)"},
		{"stream", "export const value = Stream.make(1, 2).take(1)", "Stream.take(Stream.make(1, 2)"},
		{"effect", "export const value = Effect.succeed(1).map((n) => n + 1)", "Effect.map(Effect.succeed(1)"},
		{"direct alias", "import * as O from \"effect/Option\"; const Option = 42; export function value(input: O.Option<number>) { return input.map((n) => n + 1) }", "O.map(input"},
		{"failure channel", "export const value = Effect.fail(\"old\").mapError((e) => e + \"!\")", "Effect.mapError(Effect.fail(\"old\")"},
		{"native", "export const value = [1, 2].map((n) => n + 1)", ""},
		{"own", "const x = { map: (n: number) => n + 1 }; export const value = x.map(1)", ""},
		{"namespace", "export const value = Option.map(Option.some(1), (n) => n + 1)", ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tt.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("baseline: %s", d.String())
				}
			}
			names := []tspath.RootedFilePath{file.FileName()}
			before := declarationsOf(t.Context(), program, names)
			if before[file.FileName()] == "" {
				t.Fatal("missing baseline declaration")
			}
			fs := bundled.WrapFS(osvfs.FS())
			config := keepConfig(t, filepath.Dir(file.FileName().AsString()))
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if tt.want == "" {
				if fixed != nil {
					t.Fatalf("ordinary method changed: %s", fixed.Text)
				}
				return
			}
			if fixed == nil || !strings.Contains(fixed.Text, tt.want) {
				t.Fatalf("missing rewrite %q: %+v", tt.want, fixed)
			}
			for _, comment := range []string{"/* receiver */", "/* dot */", "/* name */", "/* argument */"} {
				if strings.Contains(tt.source, comment) && strings.Count(fixed.Text, comment) != 1 {
					t.Fatalf("lost comment %q: %s", comment, fixed.Text)
				}
			}
			after := fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, map[tspath.RootedFilePath]string{file.FileName(): fixed.Text})
			if !reflect.DeepEqual(before, declarationsOf(t.Context(), after, names)) {
				t.Fatalf("declarations changed: %v -> %v", before, declarationsOf(t.Context(), after, names))
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if again.Err != nil || len(again.Files) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}

func TestFixDataMethodRefusals(t *testing.T) {
	for _, source := range []string{
		"import { some } from \"effect/Option\"; const Option = 42; export const value = some(1).map((n) => n + 1)",
		"import type * as O from \"effect/Option\"; import { some } from \"effect/Option\"; const Option = 42; export const value = some(1).map((n) => n + 1)",
		"export const value = Option.some(1).isSome<number>()",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("invalid baseline: %s", d.String())
			}
		}
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), keepConfig(t, filepath.Dir(file.FileName().AsString())), FixOptions{MigrationOnly: true})
		if result.Err != nil || len(result.Files) != 0 || len(result.Refused) == 0 {
			t.Fatalf("unsafe rewrite was not refused: %+v", result)
		}
		if result.Refused[0].Rewrite != "data-method namespace calls" {
			t.Fatalf("refusal not named: %+v", result.Refused)
		}
	}
}

// A syntactically value import used only by types is elided by TypeScript.
// Reusing it can start a re-exporting module that never ran before.
func TestFixDataMethodKeepsElidedImports(t *testing.T) {
	for _, tt := range []struct {
		name                      string
		verbatim, pinned, wantFix bool
	}{
		{"elided", false, false, false},
		{"verbatim", true, false, false},
		{"verbatim core pinned", true, true, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			source := "import { Option as O } from \"./bridge.js\"; const Option = 42; export function update(value: O.Option<number>) { return value.map((n) => n + 1) }"
			if tt.pinned {
				source = "import \"effect/Option\"; " + source
			}
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "bridge.ts"), []byte("export { Option } from \"effect\"; (globalThis as any).__dataImportPhase = 1"), 0600); err != nil {
				t.Fatal(err)
			}
			if tt.verbatim {
				if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"verbatimModuleSyntax":true},"files":["main.vibe"]}`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), keepConfig(t, dir), FixOptions{MigrationOnly: true})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if tt.wantFix {
				if len(result.Files) != 1 || len(result.Refused) != 0 {
					t.Fatalf("a pinned import was not reused: %+v", result)
				}
			} else if len(result.Files) != 0 || len(result.Refused) != 1 {
				t.Fatalf("module initialization changed: %+v", result)
			}
		})
	}
}

func TestFixDataMethodRuntimeImportOrder(t *testing.T) {
	for _, tt := range []struct {
		name, prefix string
		wantFix      bool
	}{
		{"core first", "import * as O from \"effect/Option\"; import \"./observer.js\";", true},
		{"core after observer", "import \"./observer.js\"; import * as O from \"effect/Option\";", false},
		{"already live after observer", "import \"./observer.js\"; import * as O from \"effect/Option\";", false},
		{"root alias", "import { Option as O } from \"effect\";", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			receiver := "value"
			if strings.HasPrefix(tt.name, "already live") {
				receiver = "O.some(1)"
			}
			source := tt.prefix + "const Option=42; export function update(value: O.Option<number>) { return " + receiver + ".map((n)=>n+1) }"
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "observer.ts"), []byte("export const seen:string[]=[]; const previous=Symbol.for; Symbol.for=(key:string)=>{seen.push(key);return previous(key)}"), 0600); err != nil {
				t.Fatal(err)
			}
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), keepConfig(t, dir), FixOptions{MigrationOnly: true})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if tt.wantFix {
				if len(result.Files) != 1 || len(result.Refused) != 0 {
					t.Fatalf("safe order was not migrated: %+v", result)
				}
			} else if len(result.Files) != 0 || len(result.Refused) == 0 {
				t.Fatalf("runtime import order was not preserved: %+v", result)
			}
		})
	}
}
