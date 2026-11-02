package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// vibelang --fix writes the return type of each unannotated helper that plain
// code calls or passes (D500), and only that fix of EK1001, EK9203 and
// EK4301: an exported helper, whose TypeScript API the annotation would
// change, and a helper whose body runs an Effect keep their diagnostics.
func TestFixWritesHelperReturnTypes(t *testing.T) {
	source := `function twice(n: number) { return n * 2 }
const inc = (n: number) => n + 1
function half(n: number) { return n / 2 }
function quarter(n: number) { return half(half(n)) }
function logged(n: number) { Console.log("n"); return n }
export function shared(n: number) { return n + 1 }
const doubled = [1, 2].map(twice)
const bumped = [1, 2].map((n) => inc(n))
const first = twice(3)
function plain(n: number): number { return quarter(n) }
const kept = [1].map(logged)
const exported = [1].map(shared)
export function main() { return [doubled, bumped, first, plain(4), kept, exported] }
`
	want := `function twice(n: number): number { return n * 2 }
const inc = (n: number): number => n + 1
function half(n: number): number { return n / 2 }
function quarter(n: number): number { return half(half(n)) }
function logged(n: number) { Console.log("n"); return n }
export function shared(n: number) { return n + 1 }
const doubled = [1, 2].map(twice)
const bumped = [1, 2].map((n) => inc(n))
const first = twice(3)
function plain(n: number): number { return quarter(n) }
const kept = [1].map(logged)
const exported = [1].map(shared)
export function main() { return [doubled, bumped, first, plain(4), kept, exported] }
`
	p, file, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
	fixed, ok := result.Files[file.FileName()]
	if !ok {
		t.Fatalf("--fix changed nothing: %+v", result)
	}
	if fixed.Text != want {
		t.Fatalf("--fix writes\n%s\nwant\n%s", fixed.Text, want)
	}
	checked, next, _, _ := editorProgram(t, fixed.Text)
	var left []int32
	for _, d := range checked.GetSemanticDiagnostics(t.Context(), next) {
		if d.Category() == diagnostics.CategoryError {
			left = append(left, d.Code())
		}
	}
	if len(left) != 2 || left[0] != EK4301.Code || left[1] != EK4301.Code {
		t.Fatalf("after --fix, want EK4301 at logged and shared only, got %v", left)
	}
}

// EK9203 at a return annotation that is itself a function type, as in
// `(): () => Effect.Effect<number, never, never> => { Effect.succeed(1); … }`:
// the annotation has no body to find a running call in, so --fix looks in
// the annotated function instead, finds no .vibe helper behind
// Effect.succeed, and leaves the annotation alone; its other fixes still
// apply, and EK9203 stays. It used to walk the annotation's missing body
// and panic in ast.IsClassLike (FuzzFix crash:ast.IsClassLike).
func TestFixKeepsFunctionTypeReturnAnnotation(t *testing.T) {
	source := `export const invalid = (): () => Effect.Effect<number, never, never> => {
  Effect.succeed(1)
  return effect (): Effect.Effect<number, never, never> => 1
}
`
	p, file, _, _ := editorProgram(t, source)
	reported := false
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		reported = reported || d.Code() == EK9203.Code
	}
	if !reported {
		t.Fatal("want EK9203 at the return annotation")
	}
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	text := source
	if fixed, ok := result.Files[file.FileName()]; ok {
		text = fixed.Text
	}
	if !strings.HasPrefix(text, "export const invalid = (): () => Effect.Effect<number, never, never> => {") {
		t.Fatalf("--fix rewrote the function type annotation:\n%s", text)
	}
	checked, next, _, _ := editorProgram(t, text)
	var left []int32
	for _, d := range checked.GetSemanticDiagnostics(t.Context(), next) {
		if d.Category() == diagnostics.CategoryError {
			left = append(left, d.Code())
		}
	}
	if len(left) != 1 || left[0] != EK9203.Code {
		t.Fatalf("after --fix, want EK9203 only, got %v:\n%s", left, text)
	}
}

// The helper behind such an annotation still gets its return type: when the
// annotated function's first Effect call calls an unannotated .vibe helper
// whose body only computes, --fix writes that helper's type, and the file
// then compiles without a diagnostic.
func TestFixWritesHelperBehindFunctionTypeReturnAnnotation(t *testing.T) {
	source := `function twice(n: number) { return n * 2 }
export const make = (): () => number => {
  const two = twice(1)
  return () => two
}
`
	want := `function twice(n: number): number { return n * 2 }
export const make = (): () => number => {
  const two = twice(1)
  return () => two
}
`
	p, file, _, _ := editorProgram(t, source)
	reported := false
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		reported = reported || d.Code() == EK9203.Code
	}
	if !reported {
		t.Fatal("want EK9203 at the return annotation")
	}
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed, ok := result.Files[file.FileName()]
	if !ok {
		t.Fatalf("--fix changed nothing: %+v", result)
	}
	if fixed.Text != want {
		t.Fatalf("--fix writes\n%s\nwant\n%s", fixed.Text, want)
	}
	checked, next, _, _ := editorProgram(t, fixed.Text)
	for _, d := range checked.GetSemanticDiagnostics(t.Context(), next) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("after --fix, want no error, got %d: %s", d.Code(), d.String())
		}
	}
}
