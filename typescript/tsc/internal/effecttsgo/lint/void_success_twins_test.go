package lint

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/ast"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The oracle runs the pinned rule directly on TypeScript, independently of
// vibeAnswers and lintRuleNames. VIP-38 requires the same rule on both inputs.
func TestLintVoidSuccessMatchesTypeScript(t *testing.T) {
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../../experiments/node_modules"
	}
	effect, err := filepath.Abs(filepath.Join(modules, "effect"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(effect, "package.json")); err != nil {
		t.Skipf("install Effect: %v", err)
	}
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(effect, filepath.Join(dir, "node_modules", "effect")); err != nil {
		t.Fatal(err)
	}
	write := func(name, text string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("package.json", `{"type":"module"}`)
	write("tsconfig.json", `{"compilerOptions":{"target":"es2022","module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"include":["ts","vibe"]}`)
	header := "import { Effect, Stream } from \"effect\"\n"
	witnesses := []struct {
		key, ts, vibe string
		want          int
	}{
		{"alchemy-stream-collect", "export const work = Effect.gen(function* () { return yield* Stream.make(1, 2).pipe(Stream.runCollect) })", "export effect function work() { return try Stream.make(1, 2).pipe(Stream.runCollect) }", 0},
		{"generic-program", "const id = <A>(a: A): A => a; export const work = Effect.gen(function* () { return id(Effect.succeed(1)) })", "const id = <A>(a: A): A => a; export effect function work() { return id(Effect.succeed(1)) }", 0},
		{"nested-void-variable", "export const work: Effect.Effect<void> = Effect.succeed(Effect.succeed(1))", "", 1},
		{"nested-void-return", "export function work(): Effect.Effect<void> { return Effect.succeed(Effect.succeed(1)) }", "", 1},
		{"nested-void-argument", "declare function take(a: Effect.Effect<void>): void; export const work = take(Effect.succeed(Effect.succeed(1)))", "", 1},
		{"plain-void", "export const work: Effect.Effect<void> = Effect.succeed(undefined)", "", 0},
		{"explicit-nested", "export const work: Effect.Effect<Effect.Effect<number>> = Effect.succeed(Effect.succeed(1))", "", 0},
	}
	var files []string
	for _, w := range witnesses {
		if w.vibe == "" {
			w.vibe = w.ts
		}
		for ext, body := range map[string]string{".ts": w.ts, ".vibe": w.vibe} {
			write(strings.TrimPrefix(ext, ".")+"/"+w.key+ext, header+body+"\n")
			files = append(files, filepath.Join(dir, strings.TrimPrefix(ext, "."), w.key+ext))
		}
	}
	sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
	name := tspath.RootedFilePath(tspath.NormalizePath(filepath.Join(dir, "tsconfig.json")))
	parsed, errs := tsoptions.GetParsedCommandLineOfConfigFilePath(name, sys.FS().CaseSensitivity().PathKey(tspath.RootedPath(name)), nil, nil, sys.FS(), &tsc.ExtendedConfigCache{})
	if parsed == nil || len(errs) != 0 {
		t.Fatalf("config: %v", errs)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(sys.FS(), sys.DefaultLibraryPath(), nil, nil, nil)})
	ctx := context.Background()
	for _, severity := range []etscore.Severity{etscore.SeverityError, etscore.SeverityWarning, etscore.SeverityOff} {
		config := &Config{Dir: dir, Rules: map[string]etscore.Severity{"effectInVoidSuccess": severity}}
		actual, skipped, err := lintProject(ctx, sys, filepath.Join(dir, "tsconfig.json"), files, config)
		if err != nil || len(skipped) != 0 {
			t.Fatalf("lint: %v; skipped %v", err, skipped)
		}
		opts := etscore.ParseFromPlugins([]any{map[string]any{"name": etscore.EffectPluginName}})
		opts.DiagnosticSeverity = severityFor(config, "")
		for _, w := range witnesses {
			sf := program.GetSourceFile(tspath.RootedFilePath(filepath.Join(dir, "ts", w.key+".ts")))
			program.GetSemanticDiagnostics(ctx, sf)
			c, done := program.GetTypeCheckerForFile(ctx, sf)
			oracle := runRules(ctx, program, c, sf, opts, []string{"effectInVoidSuccess"})
			done()
			want := w.want
			if severity == etscore.SeverityOff {
				want = 0
			}
			if len(oracle) != want {
				t.Errorf("%s/%v: pinned rule got %d, want %d: %v", w.key, severity, len(oracle), want, oracle)
			}
			for _, ext := range []string{".ts", ".vibe"} {
				var got []*ast.Diagnostic
				for _, d := range actual {
					if filepath.Base(string(d.File().FileName())) != w.key+ext {
						continue
					}
					if d.Code() == 4802 && d.Category() == diagnostics.CategoryError {
						t.Errorf("%s/%v: unrelated EK4802 promoted to error: %s", w.key+ext, severity, d.MessageText())
					}
					if d.Code() == 3830 {
						got = append(got, d)
					}
				}
				if len(got) != len(oracle) {
					t.Errorf("%s/%v: got %d void-success diagnostics, TypeScript %d", w.key+ext, severity, len(got), len(oracle))
				}
				for i, d := range got {
					if i >= len(oracle) {
						break
					}
					if d.Category() != oracle[i].Category() {
						t.Errorf("%s: severity differs", w.key+ext)
					}
					if w.vibe == "" && (d.Pos() != oracle[i].Pos() || d.End() != oracle[i].End()) {
						t.Errorf("%s: span differs: %d..%d versus %d..%d", w.key+ext, d.Pos(), d.End(), oracle[i].Pos(), oracle[i].End())
					}
				}
			}
		}
	}
	// Selecting this imported rule must not select the unrelated own warning.
	if slices.Contains(lintRuleNames, "effectInVoidSuccess") == false || vibeAnswers["effectInVoidSuccess"].ek != "" {
		t.Error("effectInVoidSuccess is still replaced by a compiler warning")
	}
}
