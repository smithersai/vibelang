package vibelang

import (
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

// The retired input is deliberately invalid under current callback contracts.
// Assert those exact errors before capturing its emitted API; the ordinary
// declaration helper still requires zero errors after the preserving repair.
func trustedEmptyLegacyDeclarations(t *testing.T, dir string) map[string]string {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	program := fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, map[tspath.RootedFilePath]string{})
	count := 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), nil), program.GetSemanticDiagnostics(t.Context(), nil)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() != 402 || d.File() == nil || filepath.Base(d.File().FileName().AsString()) != "lib.vibe" {
			t.Fatalf("unexpected legacy diagnostic: %s", d.String())
		}
		count++
	}
	if count != 2 {
		t.Fatalf("legacy wrapper must reject both unknown callbacks, got %d errors", count)
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
