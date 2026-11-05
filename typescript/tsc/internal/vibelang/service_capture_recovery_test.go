package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func serviceCaptureRecoverySource(contract, rejected string) string {
	return "type Box<U> = { value: U }; type Phantom<U> = { n: number }; export function outer<T>() { service S { static readonly key = \"capture/S\"; " + contract + "; " + rejected + " } }"
}

func TestServiceCaptureWithRejectedMembers(t *testing.T) {
	for _, contract := range []struct {
		name, text string
		capture    bool
	}{
		{"property", "value: T", true}, {"method", "read(): T", true},
		{"alias", "value: Box<T>", true}, {"constraint", "read<U extends T>(value: U): U", true},
		{"phantom", "value: Phantom<T>", false}, {"member-local", "read<U>(value: U): U", false},
		{"concrete", "value: number", false},
	} {
		for _, rejected := range []struct{ name, text string }{
			{"constructor", "constructor() {}"}, {"index", "[name: string]: unknown"},
			{"call", "(): number"}, {"getter", "get n() { return 1 }"}, {"method", "impl() { return 1 }"},
		} {
			t.Run(contract.name+"/"+rejected.name, func(t *testing.T) {
				want := map[int32]int{902: 1}
				if contract.capture {
					want[3005] = 1
				}
				serviceCaptureRecoveryErrors(t, serviceCaptureRecoverySource(contract.text, rejected.text), want)
			})
		}
	}
}

func serviceCaptureRecoveryErrors(t *testing.T, source string, want map[int32]int) {
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
	for code, n := range want {
		if got[code] != n {
			t.Fatalf("want %v, got %v: %s", want, got, source)
		}
	}
}

func TestServiceCaptureRecoveryRejectsImplementations(t *testing.T) {
	for _, member := range []string{
		"private value: T", "value: T = undefined!",
		"read(): T { return undefined! }", "get value(): T { return undefined! }",
		"effect read(): T!!", "async read(): Promise<T>", "constructor(value: T) {}",
	} {
		t.Run(member, func(t *testing.T) {
			serviceCaptureRecoveryErrors(t, serviceCaptureRecoverySource("", member), map[int32]int{902: 1})
		})
	}
}

func TestServiceCaptureRecoveryControls(t *testing.T) {
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { class Native { constructor(public value: T) {} } }", map[int32]int{})
	serviceCaptureRecoveryErrors(t, "export function outer<T>() { service S: {value:T} { static readonly key = \"capture/S\"; constructor() {} } }", map[int32]int{3005: 1, 902: 1})
	serviceCaptureRecoveryErrors(t, serviceCaptureRecoverySource("value: T", "constructor() {}")+"; export const invalid: number = \"wrong\"", map[int32]int{3005: 1, 902: 1, 2322: 1})
}
