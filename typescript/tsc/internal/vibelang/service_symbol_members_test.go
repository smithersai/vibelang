package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Name.Shape is the written member object (VIP-9), so a member keyed by a
// unique symbol belongs to it, as it does to the Effect TypeScript shape.
func TestServiceSymbolKeyedMembers(t *testing.T) {
	const service = "const tag: unique symbol = Symbol(\"tag\")\nexport service S {\n static readonly key = \"symbol/S\";\n [Symbol.iterator](): Iterator<number>;\n [Symbol.toStringTag]: string;\n [tag]: number;\n [Symbol.asyncIterator]?: () => AsyncIterator<number>\n value: number\n}\n"
	for _, tc := range []struct {
		name, source string
		want         []int32
	}{
		{"complete implementation", "export const impl: S.Shape = { value: 1, [Symbol.iterator]: null as never, [Symbol.toStringTag]: \"S\", [tag]: 1 }\n", nil},
		{"optional member written", "export const impl: S.Shape = { value: 1, [Symbol.iterator]: null as never, [Symbol.toStringTag]: \"S\", [tag]: 1, [Symbol.asyncIterator]: undefined }\n", nil},
		{"missing method", "export const impl: S.Shape = { value: 1, [Symbol.toStringTag]: \"S\", [tag]: 1 }\n", []int32{2741}},
		{"missing unique symbol", "export const impl: S.Shape = { value: 1, [Symbol.iterator]: null as never, [Symbol.toStringTag]: \"S\" }\n", []int32{2741}},
		{"wrong type", "export const impl: S.Shape = { value: 1, [Symbol.iterator]: null as never, [Symbol.toStringTag]: 1, [tag]: 1 }\n", []int32{2418}},
		{"keyof", "export const key: keyof S.Shape = tag\nexport const other: keyof S.Shape = Symbol.iterator\n", nil},
		{"member read", "export effect function read() {\n const s = try S\n const tagged: string = s[Symbol.toStringTag]\n const n: number = s[tag]\n return [tagged, n, s[Symbol.iterator]]\n}\n", nil},
		{"provide", "export effect function run() {\n provide S = { value: 1, [Symbol.iterator]: null as never, [Symbol.toStringTag]: \"S\", [tag]: 1 } { return (try S)[tag] }\n}\n", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, service+tc.source)
			var got []int32
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
					t.Logf("diagnostic: %s", d.String())
				}
			}
			slices.Sort(got)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("want error codes %v, got %v", tc.want, got)
			}
		})
	}
}

// A written whole shape and string or numeric keys keep their members too.
func TestServiceSymbolKeyedMemberControls(t *testing.T) {
	const source = "type Shape = { [Symbol.iterator](): Iterator<number>; value: number }\nexport service Whole: Shape { static readonly key = \"symbol/Whole\" }\nexport const whole: Context.Service.Shape<typeof Whole> = { value: 1, [Symbol.iterator]: null as never }\nexport service Named {\n static readonly key = \"symbol/Named\";\n [\"literal\"]: string;\n 42: number\n}\nexport const named: Named.Shape = { literal: \"x\", 42: 1 }\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
}
