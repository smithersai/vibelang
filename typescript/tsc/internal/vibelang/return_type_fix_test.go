package vibelang

import (
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
