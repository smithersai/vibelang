package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A do expression previously converted to a program at an Effect parameter.
// Migrating it must defer its statements and preserve their completion value,
// including a branch, while leaving ordinary do expressions immediate.
func TestFixDoProgram(t *testing.T) {
	source := `export effect function main() {
  const held: Effect.Effect<number> = succeed(4)
  const immediate = do { 1 }
  const existing = Effect.exit(do { held })
  return try Effect.exit(do { if (true) { 2 } else { 3 } })
}
`
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	edits, _ := doProgramEdits(c, file)
	got := applyEdits(source, edits)
	want := `export effect function main() {
  const held: Effect.Effect<number> = succeed(4)
  const immediate = do { 1 }
  const existing = Effect.exit(do { held })
  return try Effect.exit(effect { return do { if (true) { 2 } else { 3 } } })
}
`
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestFixDoProgramCommand(t *testing.T) {
	for name, options := range map[string]FixOptions{"default": {}, "vip": {VIPOnly: true}} {
		t.Run(name, func(t *testing.T) {
			source := `export effect function main() {
 const held: Effect.Effect<number> = succeed(4)
  const immediate = do { 1 }
  const existing = Effect.exit(do { held })
 return try Effect.exit(do { if (true) { 2 } else { 3 } })
}
`
			_, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")))
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			fixed := result.Files[file.FileName()]
			exit := "Effect.exit"
			if !options.VIPOnly {
				exit = "exit" // VIP-6 canonicalizes an available, unshadowed global.
			}
			if fixed == nil || !strings.Contains(fixed.Text, exit+"(effect { return do {") || !strings.Contains(fixed.Text, "const immediate = do { 1 }") || !strings.Contains(fixed.Text, "Effect.exit(do { held })") {
				t.Fatalf("missing migration: %+v; refused: %+v", fixed, result.Refused)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			if len(again.Files) != 0 {
				t.Fatalf("second run wrote: %+v\nfirst:\n%s\nsecond:\n%s\nrewrites: %+v", again.Files, fixed.Text, again.Files[file.FileName()].Text, again.Files[file.FileName()].Rewrites)
			}
		})
	}
}

// try do { … } ran a do in effect code as a program through VibeLang 0.0.10.
// VIP-2 runs the block now and try runs its value, so a do whose value is not
// an Effect migrates to an effect block that runs it, keeping the old timing
// and value. A do whose value is an Effect keeps its try.
func TestFixTryDoProgram(t *testing.T) {
	source := `export effect function main() {
  const held: Effect.Effect<number> = succeed(4)
  const late = try do { try sleep("1 millis"); "late" }
  const kept = try do { held }
  return [late, kept]
}
`
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	edits, _ := doProgramEdits(c, file)
	got := applyEdits(source, edits)
	want := `export effect function main() {
  const held: Effect.Effect<number> = succeed(4)
  const late = try effect { return do { try sleep("1 millis"); "late" } }
  const kept = try do { held }
  return [late, kept]
}
`
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}
