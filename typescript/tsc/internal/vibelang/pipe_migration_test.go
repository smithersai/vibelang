package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestPipeMigrationFixAndIdempotence(t *testing.T) {
	for _, source := range []string{
		`export function use() { return pipe(() => 5, Effect.map(n => n + 1)) }`,
		`export function use() { return pipe(() => { sleep(1); return 5 }, Effect.retry({ times: 1 }), Effect.timeout("1 second")) }`,
		`error Missing { name: string }; function work() { throw new Missing({ name: "region" }) }; export function use() { return pipe(() => work(), Effect.mapError(error => error.name), Effect.catch(message => message)) }`,
		`function inspect(value: number!!): string
function inspect(value: unknown): string
function inspect(value: unknown): string { return Effect.isEffect(value) ? "program" : "function" }; export function use() { return pipe(() => 5, inspect) }`,
		`export function use() { return pipe(() => pipe(() => { sleep(1); return 5 }, Effect.orDie), Effect.orDie) }`,
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("migration: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if fixed.Counts[1023] < 1 || strings.Contains(fixed.Text, "pipe(") {
				t.Fatalf("did not migrate pipe: %s", fixed.Text)
			}
			checked, next, _, _ := editorProgram(t, fixed.Text)
			for _, d := range checked.GetSemanticDiagnostics(t.Context(), next) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source reports %v\n%s", d, fixed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("second fix changed the project: %+v", again)
			}
		})
	}
}

func TestPipeMigrationRefusesForeignStageArguments(t *testing.T) {
	source := `import { make } from "./foreign.js"; export function use() { return pipe(() => 5, Effect.retry(make())) }`
	p, file, _, _ := editorProgram(t, source)
	// Deliberately unresolved calls are also incomplete analysis, never a guess.
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if len(result.Files) != 0 || len(result.Refused) != 1 || !strings.Contains(result.Refused[0].Error, "outside .vibe and effect") {
		t.Fatalf("unsafe migration accepted for %s: %+v", file.FileName(), result)
	}
}

func TestPipeFirstArgumentAlwaysHasItsFunctionForm(t *testing.T) {
	for _, stage := range []string{
		`function stage(value: number!!): number!! { return value }`,
		`function stage(value: () => number): number { return value() }`,
		`function stage(value: number!!): boolean; function stage(value: unknown): boolean; function stage(value: unknown): boolean { return Effect.isEffect(value) }`,
	} {
		p, file, _, _ := editorProgram(t, stage+`; export function use() { return pipe(() => 5, stage) }`)
		p.GetSemanticDiagnostics(t.Context(), file)
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		a := analyzerFor(c)
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if isLambda(n) && strings.Contains(file.Text()[n.Pos():n.End()], "5") {
				// pipe's first parameter is a type parameter, which gives no
				// form: the literal is an Effect function, never a program (D500).
				if form := a.finalForm(n); form != formEffect {
					t.Errorf("first argument took form %v for %s", form, stage)
				}
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		done()
	}
}

func TestPipeMigrationRefusesIntermediateProgramAsData(t *testing.T) {
	p, _, _, _ := editorProgram(t, `export function use() { return pipe(() => 5, Effect.retry({ times: 1 }), Effect.isEffect) }`)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if len(result.Files) != 0 || len(result.Refused) != 1 || !strings.Contains(result.Refused[0].Error, "program as data") {
		t.Fatalf("unsafe migration: %+v", result)
	}
}

func TestPipeSilentOverloadMigration(t *testing.T) {
	source := `function inspect(value: number!!): string; function inspect(value: unknown): string; function inspect(value: unknown): string { return Effect.isEffect(value) ? "program" : "function" }; export function use() { return pipe(() => 5, inspect) }`
	p, file, _, _ := editorProgram(t, source)
	var codes []int32
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Code())
		}
	}
	if len(codes) != 1 || codes[0] != 1023 {
		t.Fatalf("silent change must report only EK1023, got %v", codes)
	}
}

func TestPipeMigrationRefusesRecreatingNamedCallbacks(t *testing.T) {
	p, _, _, _ := editorProgram(t, `export function use() { return pipe(() => 5, Effect.map(function same(n: number) { return n }), Effect.retry({ times: 1 })) }`)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if len(result.Files) != 0 || len(result.Refused) != 1 || !strings.Contains(result.Refused[0].Error, "identity") {
		t.Fatalf("callback would be rebuilt: %+v", result)
	}
}
