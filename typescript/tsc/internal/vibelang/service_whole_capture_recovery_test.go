package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func wholeShapeCaptureSource(shape, member string) string {
	return "type Concrete = { n: number }; type Box<U> = { n: U }; type Phantom<U> = { n: number }; export function outer<T>() { service S: " + shape + " { static readonly key = \"whole/S\"; " + member + " } }"
}

func TestWholeShapeServiceRejectedMemberCapture(t *testing.T) {
	for _, shape := range []struct {
		name, text string
		capture    bool
	}{
		{"object", "{ n: number }", false}, {"named", "Concrete", false},
		{"phantom", "Phantom<T>", false}, {"primitive", "number", false},
		{"union", "number | { n: number }", false}, {"tuple", "[number]", false},
		{"captured-object", "{ n: T }", true}, {"captured-alias", "Box<T>", true},
		{"captured-tuple", "[T]", true},
	} {
		for _, member := range []struct{ name, text string }{
			{"field", "value: T"}, {"method", "read(): T"}, {"parameter", "read(value: T): number"},
			{"initializer", "value: T = undefined!"}, {"private", "private value: T"},
			{"protected", "protected value: T"}, {"public", "public value: T"},
			{"async", "async read(): Promise<T>"}, {"override", "override value: T"},
			{"bound", "read<U extends T>(value: U): U"}, {"body", "read(value: T): T { return value }"},
		} {
			t.Run(shape.name+"/"+member.name, func(t *testing.T) {
				want := map[int32]int{902: 1}
				if shape.capture {
					want[3005] = 1
				}
				wholeShapeCaptureErrors(t, wholeShapeCaptureSource(shape.text, member.text), want)
			})
		}
	}
}

func wholeShapeCaptureErrors(t *testing.T, source string, want map[int32]int) {
	t.Helper()
	p, file, _, _ := editorProgram(t, source)
	got := map[int32]int{}
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			got[d.Code()]++
		}
	}
	if len(got) != len(want) {
		t.Fatalf("want %v, got %v: %s", want, got, source)
	}
	for code, count := range want {
		if got[code] != count {
			t.Fatalf("want %v, got %v: %s", want, got, source)
		}
	}
}

func TestWholeShapeServiceCaptureControls(t *testing.T) {
	wholeShapeCaptureErrors(t, wholeShapeCaptureSource("Concrete", ""), map[int32]int{})
	wholeShapeCaptureErrors(t, wholeShapeCaptureSource("Phantom<T>", ""), map[int32]int{})
	wholeShapeCaptureErrors(t, wholeShapeCaptureSource("Box<T>", ""), map[int32]int{3005: 1})
	wholeShapeCaptureErrors(t, "export function outer<T>() { class Native { constructor(public value: T) {} } }", map[int32]int{})
	wholeShapeCaptureErrors(t, wholeShapeCaptureSource("Concrete", "value: T")+"; export const invalid: number = \"wrong\"", map[int32]int{902: 1, 2322: 1})
}
