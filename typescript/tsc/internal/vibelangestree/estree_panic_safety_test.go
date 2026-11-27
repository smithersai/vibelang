package vibelangestree

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func TestWriteRejectsUnsupportedTopLevelValueWithoutPanic(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	err := write(&b, struct{ X int }{X: 1}, newPositions(""))
	if err == nil || !strings.Contains(err.Error(), "cannot write a value") {
		t.Fatalf("expected unsupported value error, got %v", err)
	}
}

func TestWriteRejectsUnsupportedNestedObjectValueWithoutPanic(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	o := (&obj{}).set("bad", make(chan int))
	err := write(&b, o, newPositions(""))
	if err == nil || !strings.Contains(err.Error(), "cannot write a value") {
		t.Fatalf("expected nested object error, got %v", err)
	}
}

func TestWriteRejectsUnsupportedAnySliceValueWithoutPanic(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	err := write(&b, []any{"ok", complex(1, 2)}, newPositions(""))
	if err == nil || !strings.Contains(err.Error(), "cannot write a value") {
		t.Fatalf("expected slice element error, got %v", err)
	}
}

func TestWriteRejectsUnsupportedObjSliceValueWithoutPanic(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	bad := (&obj{}).set("k", func() {})
	err := write(&b, []*obj{bad}, newPositions(""))
	if err == nil || !strings.Contains(err.Error(), "cannot write a value") {
		t.Fatalf("expected obj slice error, got %v", err)
	}
}

func TestConverterFailRecordsErrorAndStopsWithoutPanic(t *testing.T) {
	t.Parallel()
	factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
	unsupportedNode := factory.NewToken(ast.KindEndOfFile)
	c := &converter{text: "", scan: scanner.NewScanner()}
	c.scan.SetText("")
	got := c.convertChild(unsupportedNode, nil)
	if got != nil {
		t.Fatalf("expected nil node on unsupported kind, got %v", got)
	}
	if c.err == nil || !strings.Contains(c.err.message, "has no ESTree form") {
		t.Fatalf("expected recorded unsupported error, got %+v", c.err)
	}
}

func TestConvertTypeArgumentsEmptyListReturnsSyntaxErrorWithoutPanic(t *testing.T) {
	t.Parallel()
	c := &converter{text: "f<>()", scan: scanner.NewScanner()}
	c.scan.SetText(c.text)
	emptyList := &ast.NodeList{Loc: core.NewTextRange(2, 2)}
	if got := c.convertTypeArguments(emptyList, nil); got != nil {
		t.Fatalf("expected nil for empty type argument list, got %v", got)
	}
	if c.err == nil || !strings.Contains(c.err.message, "Type argument list cannot be empty") {
		t.Fatalf("expected empty type argument error, got %+v", c.err)
	}
}

func TestConvertTypeParametersEmptyListReturnsSyntaxErrorWithoutPanic(t *testing.T) {
	t.Parallel()
	c := &converter{text: "function f<>() {}", scan: scanner.NewScanner()}
	c.scan.SetText(c.text)
	emptyList := &ast.NodeList{Loc: core.NewTextRange(11, 11)}
	if got := c.convertTypeParameters(emptyList, nil); got != nil {
		t.Fatalf("expected nil for empty type parameter list, got %v", got)
	}
	if c.err == nil || !strings.Contains(c.err.message, "Type parameter list cannot be empty") {
		t.Fatalf("expected empty type parameter error, got %+v", c.err)
	}
}

func TestModuleDeclarationMissingBodyRecordsErrorWithoutPanic(t *testing.T) {
	t.Parallel()
	factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
	node := factory.NewIdentifier("m")
	c := &converter{text: "module m {}", scan: scanner.NewScanner(), modules: map[*ast.Node]*ast.SourceFile{}}
	c.scan.SetText(c.text)
	if got := c.moduleDeclaration(node); got != nil {
		t.Fatalf("expected nil when module body is missing, got %v", got)
	}
	if c.err == nil {
		t.Fatal("expected recorded error for missing module body")
	}
}

func TestParseStatementsAndLoopsRoundTripJSON(t *testing.T) {
	t.Parallel()
	src := `
function run(xs: number[]) {
  let total = 0
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === 0) continue
    total += xs[i]
  }
  while (total > 10) { total-- }
  do { total++ } while (total < 1)
  try { return total } catch (e) { throw e } finally {}
}
`
	out, err := Parse("loops.ts", src)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	var parsed map[string]any
	if jerr := json.Unmarshal([]byte(out), &parsed); jerr != nil {
		t.Fatalf("invalid ESTree JSON: %v", jerr)
	}
	if parsed["type"] != "Program" {
		t.Fatalf("expected Program root, got %v", parsed["type"])
	}
}

func TestParseComplexTypesAndGenericsRoundTripJSON(t *testing.T) {
	t.Parallel()
	src := `
type Mapped<T extends Record<string, unknown>> = {
  readonly [K in keyof T]?: T[K] extends infer U ? [label: U, ...U[]] : never
}
type Pred = (x: unknown) => x is string
type Tpl = ` + "`hello-${string}`" + `
`
	out, err := Parse("types.ts", src)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	var parsed map[string]any
	if jerr := json.Unmarshal([]byte(out), &parsed); jerr != nil {
		t.Fatalf("invalid ESTree JSON: %v", jerr)
	}
	if parsed["type"] != "Program" {
		t.Fatalf("expected Program root, got %v", parsed["type"])
	}
}

func TestParseClassesAndPatternsRoundTripJSON(t *testing.T) {
	t.Parallel()
	src := `
interface Runnable { run(): void }
class Worker<T> implements Runnable {
  static { }
  readonly value: T
  constructor(value: T) { this.value = value }
  run(): void {
    const [first = 1, ...rest] = [1, 2, 3]
    const { a: renamed = 0 } = { a: first + rest.length }
    void renamed
  }
}
`
	out, err := Parse("classes.ts", src)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}
	var parsed map[string]any
	if jerr := json.Unmarshal([]byte(out), &parsed); jerr != nil {
		t.Fatalf("invalid ESTree JSON: %v", jerr)
	}
	if parsed["type"] != "Program" {
		t.Fatalf("expected Program root, got %v", parsed["type"])
	}
}

func TestErrorFormattingMethods(t *testing.T) {
	t.Parallel()
	factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
	u := unsupported{node: factory.NewIdentifier("x"), pos: 4}
	if !strings.Contains(u.Error(), "Identifier") {
		t.Fatalf("unexpected unsupported.Error(): %q", u.Error())
	}
	se := syntaxError{pos: 2, message: "bad syntax"}
	if se.Error() != "bad syntax" {
		t.Fatalf("unexpected syntaxError.Error(): %q", se.Error())
	}
	e := &Error{Message: "oops", Index: 1, Line: 2, Column: 3}
	if e.Error() != "2:3: oops" {
		t.Fatalf("unexpected Error.Error(): %q", e.Error())
	}
}
