package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"unicode"
)

// VIP-4 detail 282 and VIP-34: keep the public API and the exact thrown value.
func TestTrustedEmptyMigration(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/trusted-empty-migration"), root)
	legacy, err := os.ReadFile(filepath.Join(root, "typescript/tsc/internal/vibelang/testdata/trusted-empty-legacy.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), legacy, 0600); err != nil {
		t.Fatal(err)
	}
	before := trustedEmptyLegacyDeclarations(t, dir)
	if before["lib.d.ts"] == "" {
		t.Fatal("no lib.d.ts API")
	}
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %v; refused: %v", result.Err, result.Refused)
	}
	changed := false
	for name, fixed := range result.Files {
		if filepath.Base(name.AsString()) == "lib.vibe" {
			changed = true
			// Prelude cleanup may shorten Effect.orDie to the equivalent orDie binding.
			if strings.Contains(fixed.Text, "trusted(Dialect.integer, [])") || !strings.Contains(fixed.Text, "orDie(Effect.try({ try: () => doubled(n), catch: (e) => e }))") {
				t.Fatalf("missing preserving bridge:\n%s", fixed.Text)
			}
		}
		if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if !changed {
		t.Fatal("--fix did not retire trusted(f, [])")
	}
	if after := migrationRuleDeclarations(t, dir, nil); !reflect.DeepEqual(before, after) {
		t.Fatalf("API changed:\nbefore %v\nafter %v", before, after)
	}
	if again := fixCase(t, dir); len(again.Files) != 0 {
		t.Fatalf("not a fixed point: %v", again.Order)
	}
}

func TestTrustedEmptyMigrationRefusesEscapes(t *testing.T) {
	for name, source := range map[string]string{
		"export":   "export const safe = trusted(Math.max, [])",
		"escape":   "const safe = trusted(Math.max, []); export const escaped = [safe]",
		"plain":    "const safe = trusted(Math.max, []); export function f() { return safe(1, 2) }",
		"property": "const safe = trusted(Math.max, []); export const errors = safe.name",
		"listed":   "const safe = trusted(Math.max, [Error]); export effect function f() { return safe(1, 2) }",
		"comments": "const safe = trusted(Math.max, /* approval */ []); export effect function f() { return safe(1, 2) }",
	} {
		t.Run(name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, "import { trusted } from \"vibelang-runtime\"\n"+source+"\n")
			dir := filepath.Dir(file.FileName().AsString())
			for _, fixed := range fixCase(t, dir).Files {
				if !strings.Contains(fixed.Text, "trusted(") {
					t.Fatalf("unsafe migration: %s", fixed.Text)
				}
			}
		})
	}
}

// The retired input is deliberately invalid: EK0407 retires each wrapper, and
// current callback contracts reject the unknown callbacks. Assert those exact
// errors before capturing its emitted API; the ordinary declaration helper
// still requires zero errors after the preserving repair.
func trustedEmptyLegacyDeclarations(t *testing.T, dir string) map[string]string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	program := fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, map[tspath.RootedFilePath]string{})
	count, retired := 0, 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), nil), program.GetSemanticDiagnostics(t.Context(), nil)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if (d.Code() != 402 && d.Code() != 407) || d.File() == nil || filepath.Base(d.File().FileName().AsString()) != "lib.vibe" {
			t.Fatalf("unexpected legacy diagnostic: %s", d.String())
		}
		if d.Code() == 407 {
			retired++
		} else {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("legacy wrapper must reject both unknown callbacks, got %d errors", count)
	}
	if retired != 2 {
		t.Fatalf("each retired wrapper must report EK0407, got %d", retired)
	}
	out := map[string]string{}
	var mutex sync.Mutex
	program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), ".d.ts") {
			mutex.Lock()
			defer mutex.Unlock()
			out[filepath.Base(name.AsString())] = text
		}
		return nil
	}})
	return out
}

// VIP-4's retirement: a wrapper --fix cannot prove keeps its EK0407 error at
// its own call, with a note saying --fix left it (the located refusal). A
// local namesake and a listed-failure wrapper are not the retired form.
func TestTrustedEmptyRetiredRefusalIsLocated(t *testing.T) {
	const refusal = "vibelang --fix cannot rewrite this wrapper"
	for name, c := range map[string]struct {
		source  string
		retired bool
		refused bool
	}{
		"migrated":  {"const safe = trusted(Math.max, []); export effect function f() { return safe(1, 2) }", true, false},
		"export":    {"export const safe = trusted(Math.max, [])", true, true},
		"escape":    {"const safe = trusted(Math.max, []); export const escaped = [safe]", true, true},
		"plain":     {"const safe = trusted(Math.max, []); export function f() { return safe(1, 2) }", true, true},
		"unused":    {"const safe = trusted(Math.max, [])", true, true},
		"comments":  {"const safe = trusted(Math.max, /* approval */ []); export effect function f() { return safe(1, 2) }", true, true},
		"argument":  {"export const xs = [1].map(() => trusted(Math.max, []))", true, true},
		"listed":    {"const safe = trusted(Math.max, [Error]); export effect function f() { return safe(1, 2) }", false, false},
		"namesake":  {"function trusted<F>(f: F, errors: never[]): F { return f }; const safe = trusted(Math.max, []); export effect function f() { return safe(1, 2) }", false, false},
		"namespace": {"import * as Runtime from \"vibelang-runtime\"\nconst safe = Runtime.trusted(Math.max, []); export effect function f() { return safe(1, 2) }", true, false},
		"renamed":   {"import { trusted as legacy } from \"vibelang-runtime\"\nconst safe = legacy(Math.max, ([])); export effect function f() { return safe(1, 2) }", true, true},
	} {
		t.Run(name, func(t *testing.T) {
			text := c.source
			if !strings.HasPrefix(text, "import") && name != "namesake" {
				text = "import { trusted } from \"vibelang-runtime\"\n" + text
			}
			program, file, _, _ := editorProgram(t, text+"\n")
			var found []*ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 407 {
					found = append(found, d)
				}
			}
			if !c.retired {
				if len(found) != 0 {
					t.Fatalf("not the retired wrapper, got %s", found[0].String())
				}
				return
			}
			if len(found) != 1 {
				t.Fatalf("want one EK0407, got %d", len(found))
			}
			d := found[0]
			// The call starts at its callee, the name or member path before "(Math.max".
			at := strings.Index(file.Text(), "(Math.max")
			for at > 0 && (file.Text()[at-1] == '.' || file.Text()[at-1] == '_' || unicode.IsLetter(rune(file.Text()[at-1]))) {
				at--
			}
			if d.Pos() != at || !strings.Contains(d.String(), "vibelang --fix") {
				t.Fatalf("EK0407 at %d, want the wrapper call at %d: %s", d.Pos(), at, d.String())
			}
			noted := false
			for _, related := range d.MessageChain() {
				noted = noted || strings.Contains(related.String(), refusal)
			}
			if noted != c.refused {
				t.Fatalf("refusal note %v, want %v: %s", noted, c.refused, d.String())
			}
		})
	}
}

// trustedEmptyRetiredDeclarations emits dir's declarations before the
// migration, whose only errors are EK0407 at the retired wrappers.
func trustedEmptyRetiredDeclarations(t *testing.T, dir string) map[string]string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	program := fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, map[tspath.RootedFilePath]string{})
	retired := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() != 407 {
			t.Fatalf("unexpected legacy diagnostic: %s", d.String())
		}
		retired++
	}
	if retired == 0 {
		t.Fatal("the retired wrapper reports no EK0407")
	}
	out := map[string]string{}
	var mutex sync.Mutex
	program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), ".d.ts") {
			mutex.Lock()
			defer mutex.Unlock()
			out[filepath.Base(name.AsString())] = text
		}
		return nil
	}})
	return out
}

// A call whose argument is narrowed where it stands keeps that type: the
// bridge evaluates the arguments there and gives the thunk their values, so
// the migration neither refuses nor changes the declaration output.
func TestTrustedEmptyMigrationKeepsNarrowing(t *testing.T) {
	source := `import { trusted } from "vibelang-runtime"
const len = (s: { id: string }): number => s.id.length
const safe = trusted(len, [])
type Cause = { trace?: { id: string } }
export effect function f(cause: Cause | undefined): number!! {
  return cause?.trace ? safe(cause.trace) + 1 : 0
}
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	before := trustedEmptyRetiredDeclarations(t, dir)
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 || len(result.Changed) != 0 {
		t.Fatalf("fix %v, refused %v, changed %v", result.Err, result.Refused, result.Changed)
	}
	changed := false
	for name, fixed := range result.Files {
		changed = true
		if !strings.Contains(fixed.Text, "(try Effect.orDie(Effect.try({ try: ((arg0) => () => safe(arg0))(cause.trace), catch: (e) => e }))) + 1") {
			t.Fatalf("missing the captured-argument bridge:\n%s", fixed.Text)
		}
		if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if !changed {
		t.Fatal("--fix did not retire trusted(len, [])")
	}
	if after := migrationRuleDeclarations(t, dir, nil); !reflect.DeepEqual(before, after) {
		t.Fatalf("declarations changed: %v -> %v", before, after)
	}
}

// A narrowed argument of a callee known to throw cannot move out of the
// thunk Effect.try calls, so the migration refuses that wrapper and its
// EK0407 stays, with the note that --fix cannot rewrite it.
func TestTrustedEmptyMigrationRefusesNarrowedKnownThrows(t *testing.T) {
	for _, tag := range []string{"{Error}", "{unknown}"} {
		t.Run(tag, func(t *testing.T) {
			source := "import { trusted } from \"vibelang-runtime\"\n" +
				"import { log } from \"./foreign.ts\"\n" +
				"const info = trusted(log.info, [])\n" +
				"export const work = effect (x: string | undefined) => { if (x) info(x); return 1 }\n"
			_, scratch, _, _ := editorProgram(t, source)
			dir := filepath.Dir(scratch.FileName().AsString())
			for name, text := range map[string]string{
				"foreign.ts":    "export const log = {\n/** @throws " + tag + " */ info(value: string): number { return value.length } }\n",
				"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"rewriteRelativeImportExtensions":true},"files":["main.vibe","foreign.ts"]}`,
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			program := fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, map[tspath.RootedFilePath]string{})
			file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
			if file == nil {
				t.Fatal("no main.vibe")
			}
			if p := trustedEmptyMigrationFixes(t.Context(), program, file, map[string]bool{}); len(p.fixes) != 0 {
				t.Fatalf("unsafe migration: %s", p.text())
			}
			noted := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() != 407 {
					continue
				}
				for _, related := range d.MessageChain() {
					noted = noted || strings.Contains(related.String(), "vibelang --fix cannot rewrite this wrapper")
				}
			}
			if !noted {
				t.Fatal("the refused wrapper has no located EK0407")
			}
		})
	}
}
