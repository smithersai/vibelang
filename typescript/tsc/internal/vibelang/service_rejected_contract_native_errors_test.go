package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestServiceRejectedContractNativeErrors(t *testing.T) {
	for _, tc := range []struct {
		name, member string
		code         int32
	}{
		{"get-name", "get value(): Missing", 2304},
		{"set-name", "set value(next: Missing)", 2304},
		{"get-nested-name", "get value(): { inner: Missing }", 2304},
		{"set-nested-name", "set value(next: { inner: Missing })", 2304},
		{"get-index", "get value(): { [key: string]: string; n: number }", 2411},
		{"set-index", "set value(next: { [key: string]: string; n: number })", 2411},
		{"get-nested-readonly", "get value(): { readonly method(): void }", 1024},
		{"set-nested-parameter", "set value(next: (inner) => void)", 7006},
		{"abstract-method", "abstract read(): Missing", 2304},
		{"abstract-property", "abstract value: Missing", 2304},
		{"declare-method", "declare read(): Missing", 2304},
		{"declare-property", "declare value: Missing", 2304},
		{"private-property", "private value: Missing", 2304},
		{"protected-method", "protected read(): Missing", 2304},
		{"public-property", "public value: Missing", 2304},
		{"auto-accessor", "accessor value: Missing", 2304},
		{"override-method", "override read(): Missing", 2304},
		{"readonly-method", "readonly read(): Missing", 2304},
		{"private-name", "#value: Missing", 2304},
		{"definite", "value!: Missing", 2304},
		{"effect-method", "effect read(): Missing!!", 2304},
		{"async-method", "async read(): Missing!!", 2304},
		{"async-promise", "async read(): Promise<Missing>", 2304},
		{"async-control", "async read(): Promise<number>", 0},
		{"async-effect-header", "async read(): number!!", 0},

		{"modifier-nested-readonly", "private value: { readonly method(): void }", 1024},
		{"modifier-nested-parameter", "private value: (inner) => void", 7006},
		{"get-header", "get value(): number", 0},
		{"set-header", "set value(next: number)", 0},
		{"get-untyped", "get value()", 0},
		{"set-untyped", "set value(next)", 0},
		{"get-declare", "declare get value(): number", 0},
		{"get-readonly", "readonly get value(): number", 0},
		{"abstract-control", "abstract read(): number", 0},
		{"declare-control", "declare value: number", 0},
		{"private-control", "private value: number", 0},
		{"readonly-control", "readonly read(): number", 0},
		{"definite-control", "value!: number", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export service S { static readonly key = \"contract/S\"; " + tc.member + " }"
			p, file, _, _ := editorProgram(t, source)
			got := map[int32]int{}
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
					t.Logf("%s%d %s", d.Source(), d.Code(), d.String())
				}
			}
			want := map[int32]int{902: 1}
			if tc.code != 0 {
				want[tc.code]++
			}
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("want %v got %v: %s", want, got, source)
			}
		})
	}
}

func TestServiceRejectedContractIndependentControls(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         map[int32]int
	}{
		{"effect-return", "export service S { static readonly key = \"contract/Effect\"; effect read(): Missing }", map[int32]int{902: 1, 106: 1, 2304: 1}},
		{"private-scope", "export service S { static readonly key = \"contract/Private\"; #value: Missing }; abstract class Outside { abstract #value: number }", map[int32]int{902: 1, 2304: 1, 18019: 1}},
		{"native-get", "export abstract class Native { abstract get value(): Missing }", map[int32]int{2304: 1}},
		{"native-set", "export abstract class Native { abstract set value(next: Missing) }", map[int32]int{2304: 1}},
		{"async-scope", "export service S { static readonly key = \"contract/Async\"; async read(): number!! }; async function OutsideAsync(): number { return 1 }", map[int32]int{902: 1, 1064: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			got := map[int32]int{}
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
				}
			}
			if fmt.Sprint(got) != fmt.Sprint(tc.want) {
				t.Fatalf("want %v got %v: %s", tc.want, got, tc.source)
			}
		})
	}
}
