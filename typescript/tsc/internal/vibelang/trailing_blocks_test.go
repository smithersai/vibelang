package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// trailingBlockPrelude declares what the shapes below call: a service for
// Layer.effect, a callee that takes an Effect function as it.effect does, and
// one that takes a plain callback.
const trailingBlockPrelude = `service Users { find(id: string): string!! }
function test(name: string, body: () => Effect.Effect<number>) { return body() }
function twice(f: () => number) { return f() + f() }
function generic<T>(value: T, f: () => T) { return f() ?? value }
`

// emittedJS returns the JavaScript program emits, by file name.
func emittedJS(t *testing.T, program *compiler.Program) map[string]string {
	t.Helper()
	program.GetSemanticDiagnostics(t.Context(), nil)
	out := map[string]string{}
	var mutex sync.Mutex // a program's files emit in parallel
	program.Emit(t.Context(), compiler.EmitOptions{ForceEmit: true, EmitOnly: compiler.EmitOnlyJs, WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), ".js") {
			mutex.Lock()
			defer mutex.Unlock()
			out[filepath.Base(name.AsString())] = text
		}
		return nil
	}})
	return out
}

// A comment between the call and its block has no place in the rewrite, so
// EK1101 stays and --fix refuses it rather than drop the comment.
// Chapter 007 / interargument comment refusal and dual compatibility: docs/design/src/007-tooling.md#c3c81017075e1310

// A dual block that D188 placed elsewhere keeps its own error and fix
// (dual_block_migration.go), with no EK1101 beside it.
// Chapter 007 / interargument comment refusal and dual compatibility: docs/design/src/007-tooling.md#c3c81017075e1310
func TestTrailingBlockLeavesDualBlocksToTheirMigration(t *testing.T) {
	errors := trailingBlockErrorsOf(t, dualBlockWork+"export function f() { return withSpan(\"load\") { return work() } }")
	for _, d := range errors {
		if d.Code() == EK1101.Code {
			t.Fatalf("a dual block reports EK1101: %v", errors)
		}
	}
	found := false
	for _, d := range errors {
		found = found || hasDualBlockMigrationNote(d)
	}
	if !found {
		t.Fatalf("errors %v lack the dual block's migration", errors)
	}
}

// The old layer declaration builds a Layer.effect call whose block the source
// never writes after a call, so it keeps EK2121 and draws no EK1101.
func TestTrailingBlockSkipsTheLayerDeclaration(t *testing.T) {
	errors := errorsOf(t, "service Counter { next(): number!! }\nexport layer CounterLive: Counter {\n  const start = 0\n  effect next() { return start }\n}")
	for _, d := range errors {
		if d.Code() == EK1101.Code {
			t.Fatalf("the layer declaration reports EK1101: %v", errors)
		}
	}
}

// fork { … } is fork's own block (D166), which the parser reads apart
// from block params, so it draws no EK1101.
func TestTrailingBlockLeavesForkBlocks(t *testing.T) {
	errors := errorsOf(t, "export effect function f() { const g = fork { try yieldNow; return 1 }; return join g }")
	for _, d := range errors {
		if d.Code() == EK1101.Code {
			t.Fatalf("fork { … } reports EK1101: %v", errors)
		}
	}
}

// legacyTrailingBlockErrorsOf checks the migration decoder rather than treating
// retired syntax as an accepted ordinary program.
func legacyTrailingBlockErrorsOf(t *testing.T, source string) []*ast.Diagnostic {
	t.Helper()
	p, file, _, _ := editorProgram(t, source)
	p = trailingBlockMigrationProgram(p)
	file = p.GetSourceFile(file.FileName())
	var errors []*ast.Diagnostic
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d)
		}
	}
	return errors
}

func trailingBlockErrorsOf(t *testing.T, source string) []*ast.Diagnostic {
	t.Helper()
	p, file, _, _ := editorProgram(t, source)
	var result []*ast.Diagnostic
	for _, d := range p.GetSyntacticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			result = append(result, d)
		}
	}
	return result
}

// project.compilerHost forbids parser-cache acquisition after a snapshot is
// finalized. A migration can discover a dependency the recovered native AST
// did not load, and must acquire it through its own host over the frozen FS.
type finalizedTrailingHost struct {
	compiler.CompilerHost
	finalized *atomic.Bool
}

func (h finalizedTrailingHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if h.finalized.Load() {
		panic("acquisition after snapshot initialization")
	}
	return h.CompilerHost.GetSourceFile(opts)
}

func TestTrailingBlockFinalizedHost(t *testing.T) {
	source := trailingBlockPrelude + "export const n = twice() { return 2 }"
	initial, file, _, _ := editorProgram(t, source)
	var finalized atomic.Bool
	original := compiler.NewProgram(compiler.ProgramOptions{
		Config: initial.CommandLine(),
		Host:   finalizedTrailingHost{CompilerHost: initial.Host(), finalized: &finalized},
	})
	finalized.Store(true)
	migration := trailingBlockMigrationProgram(original)
	extra := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "extra.ts")))
	if err := os.WriteFile(extra.AsString(), []byte("export const value = 42"), 0600); err != nil {
		t.Fatal(err)
	}
	loaded := migration.Host().GetSourceFile(ast.SourceFileParseOptions{FileName: extra})
	if loaded == nil || loaded.Text() != "export const value = 42" {
		t.Fatal("migration did not acquire its new dependency")
	}
	diagnostics := original.GetSyntacticDiagnostics(t.Context(), original.GetSourceFile(file.FileName()))
	found := false
	for _, d := range diagnostics {
		if d.Source() == diagnosticSource && d.Code() == EK1101.Code {
			found = true
		}
	}
	if !found {
		t.Fatalf("finalized snapshot lost EK1101: %v", diagnostics)
	}
}

// VIP-11 suppresses only a redundant missing separator at the rejected brace.
func TestTrailingBlockRecoverySeparator(t *testing.T) {
	for _, source := range []string{
		"export const n = twice() { return 2 }",
		"export const n = [twice() { return 2 }]",
		"export const n = twice() { return 2 }; export const bad = ;",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, trailingBlockPrelude+source)
			diags := p.GetSyntacticDiagnostics(t.Context(), file)
			braces := map[int]bool{}
			for _, d := range diags {
				if d.Source() == diagnosticSource && d.Code() == EK1101.Code {
					braces[d.Pos()] = true
				}
			}
			if len(braces) == 0 {
				t.Fatal("lost EK1101")
			}
			nativeCount := 0
			for _, d := range file.Diagnostics() {
				args := d.MessageArgs()
				if d.Code() == 1005 && len(args) == 1 && (args[0] == ";" || args[0] == ",") && braces[d.Pos()] {
					nativeCount++
				}
			}
			if nativeCount == 0 {
				t.Fatal("witness has no native separator; do not mutate the parser diagnostics")
			}
			for _, d := range diags {
				args := d.MessageArgs()
				if d.Source() == "" && d.Code() == 1005 && len(args) == 1 && (args[0] == ";" || args[0] == ",") && braces[d.Pos()] {
					t.Errorf("duplicate separator beside EK1101: %v", d)
				}
			}
			if strings.Contains(source, "bad = ;") {
				found := false
				for _, d := range diags {
					if d.Source() == "" && d.Code() == 1109 {
						found = true
					}
				}
				if !found {
					t.Fatal("lost independent TS1109")
				}
			}
		})
	}
}

// Chapter 900: EK1101 diagnostic - spec-rule: docs/design/src/900-appendices.md#3a2118530ddd56d4
func TestTrailingBlockRecoveryKeepsIndependentNativeErrors(t *testing.T) {
	for _, source := range []string{
		"export const n = 1 export const m = 2",
		"effect function main() { with Layer.empty {} }",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, trailingBlockPrelude+source)
			diags := p.GetSyntacticDiagnostics(t.Context(), file)
			checked := 0
			for _, native := range file.Diagnostics() {
				if native.Code() != 1005 {
					continue
				}
				checked++
				found := false
				for _, d := range diags {
					if d.Source() == native.Source() && d.Code() == native.Code() && d.Loc() == native.Loc() && d.String() == native.String() {
						found = true
					}
				}
				if !found {
					t.Errorf("lost independent native error: %v", native)
				}
			}
			if checked == 0 {
				t.Fatal("witness has no independent native TS1005")
			}
		})
	}
}
