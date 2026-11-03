package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
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

// VIP-11: every trailing block is EK1101 at its opening brace, and --fix
// writes it as the call's last argument in the spelling of what the block
// compiled to before VIP-1: an effect block where the destination takes an
// Effect, an effect arrow where it takes a function returning one, and the
// parser's plain arrow otherwise. The rewritten program reports nothing and a
// second --fix finds nothing. Under VIP-1 the parser's block is a program
// (VIP-2), so where the destination takes one it is all the block reports
// and both programs emit the same JavaScript; where it takes a function,
// TypeScript also rejects the program (TS2345) until --fix writes the
// function. The sources run Effects with try (VIP-5) and mark their Effect
// methods (VIP-1).
func TestTrailingBlockFixKeepsTheEmit(t *testing.T) {
	for _, test := range []struct {
		name, source, want string
		program            bool // the destination takes an Effect
	}{
		{"Layer.effect(S) program", "export const live = Layer.effect(Users) { return { effect find(id: string) { return id } } }",
			"export const live = Layer.effect(Users, effect { return { effect find(id: string) { return id } } })", true},
		{"Effect.scoped bare name", "export function f() { return Effect.scoped { const r = try Ref.make(1); return try Ref.get(r) } }",
			"export function f() { return Effect.scoped(effect { const r = try Ref.make(1); return try Ref.get(r) }) }", true},
		{"it.effect-like Effect function", "export function f() { return test(\"one\") { const r = try Ref.make(1); return try Ref.get(r) } }",
			"export function f() { return test(\"one\", effect () => { const r = try Ref.make(1); return try Ref.get(r) }) }", false},
		{"plain callback", "export function f() { return twice() { return 2 } }",
			"export function f() { return twice(() => { return 2 }) }", false},
		{"lexical this", "export class C { value = 2; calculate() { return twice() { return this.value } } }",
			"export class C { value = 2; calculate() { return twice(() => { return this.value }) } }", false},
		{"lexical arguments", "export function f(n: number) { return twice() { return arguments[0] as number } }",
			"export function f(n: number) { return twice(() => { return arguments[0] as number }) }", false},
		{"body comments", "export function f() { return twice() { /* keep */ return 2 /* end */ } }",
			"export function f() { return twice(() => { /* keep */ return 2 /* end */ }) }", false},
		{"trailing comma", "export function f() { return test(\"one\",) { return try Effect.succeed(1) } }",
			"export function f() { return test(\"one\", effect () => { return try Effect.succeed(1) }) }", false},
		{"type arguments", "export function f() { return generic<number>(1) { return 2 } }",
			"export function f() { return generic<number>(1, () => { return 2 }) }", false},
		{"multiline", "export const live = Layer.effect(Users)   {\n  return {\n    effect find(id: string) { return id }\n  }\n}",
			"export const live = Layer.effect(Users, effect {\n  return {\n    effect find(id: string) { return id }\n  }\n})", true},
		{"nested, one round", "export function f() { return test(\"outer\") { return try Effect.scoped { return twice() { return 3 } } } }",
			"export function f() { return test(\"outer\", effect () => { return try Effect.scoped(effect { return twice(() => { return 3 }) }) }) }", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := trailingBlockPrelude + test.source
			p, file, _, _ := editorProgram(t, source)
			errors := errorsOf(t, source)
			var ek1101 []*ast.Diagnostic
			others := 0
			for _, d := range errors {
				switch {
				case d.Source() == diagnosticSource && d.Code() == EK1101.Code:
					ek1101 = append(ek1101, d)
				case !test.program && d.Code() == 2345:
				default:
					others++
				}
			}
			if len(ek1101) == 0 || others != 0 || source[ek1101[0].Pos():ek1101[0].End()] != "{" {
				t.Fatalf("errors %v, want EK1101 at each block's brace", errors)
			}
			before := emittedJS(t, p)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("migration: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if fixed.Text != trailingBlockPrelude+test.want {
				t.Fatalf("--fix writes\n%s\nwant\n%s", fixed.Text, trailingBlockPrelude+test.want)
			}
			if errors := errorsOf(t, fixed.Text); len(errors) != 0 {
				t.Fatalf("fixed source reports %v", errors)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("second fix changed the project: %+v", again)
			}
			if !test.program {
				return
			}
			// The unnamed package's directory is part of a derived service
			// key (D1). Recheck at the original path, as --fix actually does.
			after := compiler.NewProgram(compiler.ProgramOptions{
				Config: p.CommandLine(),
				Host:   compiler.NewCompilerHost(bundled.WrapFS(osvfs.FS()), bundled.LibPath(), nil, nil, nil),
			})
			if b, a := before["main.js"], emittedJS(t, after)["main.js"]; b == "" || trailingBlockEmitShape(t, a) != trailingBlockEmitShape(t, b) {
				t.Fatalf("the rewrite changes the emit\nbefore:\n%s\nafter:\n%s", b, a)
			}
		})
	}
}

// A comment between the call and its block has no place in the rewrite, so
// EK1101 stays and --fix refuses it rather than drop the comment.
// Chapter 007 / interargument comment refusal and dual compatibility: docs/design/src/007-tooling.md#c3c81017075e1310

func TestTrailingBlockFixRefusesAComment(t *testing.T) {
	for _, source := range []string{
		"export const n = twice() /* two */ { return 2 }",
		"export const n = generic(1 /* one */) { return 2 }",
	} {
		p, _, _, _ := editorProgram(t, trailingBlockPrelude+source)
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
		if len(result.Files) != 0 {
			t.Errorf("%s: --fix wrote %+v", source, result.Files)
		}
	}
}

// A dual block that D188 placed elsewhere keeps its own error and fix
// (dual_block_migration.go), with no EK1101 beside it.
// Chapter 007 / interargument comment refusal and dual compatibility: docs/design/src/007-tooling.md#c3c81017075e1310
func TestTrailingBlockLeavesDualBlocksToTheirMigration(t *testing.T) {
	errors := errorsOf(t, dualBlockWork+"export function f() { return withSpan(\"load\") { return work() } }")
	for _, d := range errors {
		if d.Code() == EK1101.Code {
			t.Fatalf("a dual block reports EK1101: %v", errors)
		}
	}
	if len(errors) != 1 {
		t.Fatalf("errors %v, want the dual block's own", errors)
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
	errors := errorsOf(t, "export effect function f() { const g = fork { try yieldNow(); return 1 }; return join g }")
	for _, d := range errors {
		if d.Code() == EK1101.Code {
			t.Fatalf("fork { … } reports EK1101: %v", errors)
		}
	}
}

// The editor offers --fix's rewrite on EK1101.
func TestTrailingBlockCodeAction(t *testing.T) {
	source := trailingBlockPrelude + "export const live = Layer.effect(Users) { return { effect find(id: string) { return id } } }"
	program, file, service, converters := editorProgram(t, source)
	var diagnostic *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK1101.Code {
			diagnostic = d
		}
	}
	if diagnostic == nil {
		t.Fatal("no EK1101")
	}
	if want := "write the block as an argument, Layer.effect(Users, effect { … })"; !strings.Contains(diagnostic.String(), want) {
		t.Fatalf("message %q lacks %q", diagnostic.String(), want)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
	})
	if err != nil || response.CommandOrCodeActionArray == nil {
		t.Fatalf("no code action: %v", err)
	}
	for _, action := range *response.CommandOrCodeActionArray {
		if action.CodeAction != nil && action.CodeAction.Title == "Pass the block as the call's last argument" {
			return
		}
	}
	t.Fatalf("actions %+v lack the rewrite", *response.CommandOrCodeActionArray)
}

// trailingBlockEmitShape compares these fixtures' executable structure,
// ignoring printed comments and the equivalent single-return arrow body.
// Runtime preservation is separately checked by FuzzFix's Exit oracle.
func trailingBlockEmitShape(t *testing.T, text string) string {
	t.Helper()
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/emit.js", PathKey: "/emit.js"}, text, core.ScriptKindJS)
	if len(file.Diagnostics()) != 0 {
		t.Fatalf("invalid JavaScript emit: %v", file.Diagnostics())
	}
	var shape strings.Builder
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		fmt.Fprintf(&shape, "(%v", n.Kind)
		if ast.IsIdentifier(n) || ast.IsLiteralExpression(n) {
			fmt.Fprintf(&shape, ":%q", n.Text())
		}
		var body, expression *ast.Node
		if n.Kind == ast.KindArrowFunction {
			body = n.Body()
			if body.Kind == ast.KindBlock {
				statements := body.AsBlock().Statements.Nodes
				if len(statements) == 1 && statements[0].Kind == ast.KindReturnStatement {
					expression = statements[0].Expression()
				}
			}
		}
		n.ForEachChild(func(child *ast.Node) bool {
			if child == body && expression != nil {
				visit(expression)
			} else {
				visit(child)
			}
			return false
		})
		shape.WriteByte(')')
		return false
	}
	visit(file.AsNode())
	return shape.String()
}
