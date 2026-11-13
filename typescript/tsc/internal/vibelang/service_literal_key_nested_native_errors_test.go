package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// The key header owns EK0901; nested declarations retain native errors.
func TestServiceLiteralKeyNestedNativeErrors(t *testing.T) {
	for _, tc := range []struct {
		key, source string
		codes       []int32
	}{
		{"body/nested-untyped", "export service ServiceKey { static readonly key = class { untyped } }", []int32{901, 7008}},
		{"body/nested-static-untyped", "export service ServiceKey { static readonly key = class { static untyped } }", []int32{901, 7008}},
		{"body/nested-static-definite", "export service ServiceKey { static readonly key = class { static field!: number } }", []int32{901, 1255}},
		{"body/nested-both", "export service ServiceKey { static readonly key = class { untyped; static field!: number } }", []int32{901, 7008, 1255}},
		{"body/arrow-untyped", "export service ServiceKey { static readonly key = () => { class Inner { untyped }; return 'key' } }", []int32{901, 7008}},
		{"body/arrow-definite", "export service ServiceKey { static readonly key = () => { class Inner { static field!: number }; return 'key' } }", []int32{901, 1255}},
		{"body/object-class", "export service ServiceKey { static readonly key = ({ inner: class { untyped } }) }", []int32{901, 7008}},
		{"body/satisfies-class", "export service ServiceKey { static readonly key = (class { untyped }) satisfies Function }", []int32{901, 7008}},
		{"body/unknown-name", "export service ServiceKey { static readonly key = Missing }", []int32{901, 2304}},
		{"body/missing-key", "export service ServiceKey { static readonly key }", []int32{901}},
		{"body/own-definite", "export service ServiceKey { static readonly key!: string }", []int32{901}},
		{"body/valid-literal", "export service ServiceKey { static readonly key = \"key/body\" }", []int32{}},
		{"whole/nested-untyped", "export service ServiceKey: number { static readonly key = class { untyped } }", []int32{901, 7008}},
		{"whole/nested-static-untyped", "export service ServiceKey: number { static readonly key = class { static untyped } }", []int32{901, 7008}},
		{"whole/nested-static-definite", "export service ServiceKey: number { static readonly key = class { static field!: number } }", []int32{901, 1255}},
		{"whole/nested-both", "export service ServiceKey: number { static readonly key = class { untyped; static field!: number } }", []int32{901, 7008, 1255}},
		{"whole/arrow-untyped", "export service ServiceKey: number { static readonly key = () => { class Inner { untyped }; return 'key' } }", []int32{901, 7008}},
		{"whole/arrow-definite", "export service ServiceKey: number { static readonly key = () => { class Inner { static field!: number }; return 'key' } }", []int32{901, 1255}},
		{"whole/object-class", "export service ServiceKey: number { static readonly key = ({ inner: class { untyped } }) }", []int32{901, 7008}},
		{"whole/satisfies-class", "export service ServiceKey: number { static readonly key = (class { untyped }) satisfies Function }", []int32{901, 7008}},
		{"whole/unknown-name", "export service ServiceKey: number { static readonly key = Missing }", []int32{901, 2304}},
		{"whole/missing-key", "export service ServiceKey: number { static readonly key }", []int32{901}},
		{"whole/own-definite", "export service ServiceKey: number { static readonly key!: string }", []int32{901}},
		{"whole/valid-literal", "export service ServiceKey: number { static readonly key = \"key/whole\" }", []int32{}},
		{"native/untyped", "export class Native { static readonly key = class { untyped } }", []int32{7008}},
		{"native/definite", "export class Native { static readonly key = class { static field!: number } }", []int32{1255}},
		{"outside/untyped", "export service ServiceKey { static readonly key }; export class Outside { untyped }", []int32{901, 7008}},
		{"outside/definite", "export service ServiceKey { static readonly key }; export class Outside { static field!: number }", []int32{901, 1255}},
	} {
		t.Run(tc.key, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			got := map[int32]int{}
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
					t.Logf("%s%d %s", d.Source(), d.Code(), d.String())
				}
			}
			want := map[int32]int{}
			for _, code := range tc.codes {
				want[code]++
			}
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("want %v got %v: %s", want, got, tc.source)
			}
		})
	}
}
