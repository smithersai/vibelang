package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-9: Users.Shape is the written member object of the service Users. A
// namespace merged with the service, as one merges with a class, adds its
// own members beside Shape; an interface merged with it declares members of
// the identifier, as for any class, and none of the shape. Only a namespace
// that declares Shape itself replaces the compiler's Shape.
func TestServiceDeclarationMerge(t *testing.T) {
	const users = "service Users { static readonly key = \"merge/Users\"; n: number }\n"
	for _, tc := range []struct {
		name   string
		source string
		want   []int32 // error codes, in source order; nil for none
	}{
		{"namespace after", users + "namespace Users { export const x = 1 }\nexport const impl: Users.Shape = { n: 1 }\nexport const x = Users.x\n", nil},
		{"namespace with a layer", users + "namespace Users {\n  export const Live = Layer.succeed(Users, { n: 1 })\n  export const impl: Users.Shape = { n: 2 }\n}\nexport effect function read() { provide Users.Live { return (try Users).n + Users.impl.n } }\n", nil},
		{"declare namespace", users + "declare namespace Users { const x: number }\nexport const impl: Users.Shape = { n: 1 }\n", nil},
		{"namespace declares Shape", users + "namespace Users { export type Shape = { z: number } }\nexport const impl: Users.Shape = { z: 1 }\n", nil},
		{"namespace declares Shape rejects the members", users + "namespace Users { export type Shape = { z: number } }\nexport const impl: Users.Shape = { n: 1 }\n", []int32{2353}},
		{"namespace keeps the shape's members", users + "namespace Users { export const x = 1 }\nexport const impl: Users.Shape = { x: 1 }\n", []int32{2353}},
		{"interface adds no shape member", users + "interface Users { extra: string }\nexport const impl: Users.Shape = { n: 1 }\nexport const viaEffect: Context.Service.Shape<typeof Users> = { n: 1 }\n", nil},
		{"interface merged into a local service", "export function f() {\n  service Local { static readonly key = \"merge/Local\"; n: number }\n  interface Local { extra: string }\n  const impl: Context.Service.Shape<typeof Local> = { n: 1 }\n  return impl\n}\n", nil},
		{"interface and namespace", users + "interface Users { extra: string }\nnamespace Users { export const x = 1 }\nexport const impl: Users.Shape = { n: 1 }\nexport const x = Users.x\n", nil},
		{"written shape with a namespace", "service Port: { value: string } { static readonly key = \"merge/Port\" }\nnamespace Port { export const x = 1 }\nexport const impl: Context.Service.Shape<typeof Port> = { value: \"a\" }\nexport const x = Port.x\n", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var got []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				got = append(got, d.Code())
				if len(tc.want) == 0 {
					t.Errorf("unexpected error: %s", d.String())
				}
			}
			if len(tc.want) != 0 && !equalInts(got, tc.want) {
				t.Errorf("errors %v, want %v", got, tc.want)
			}
			if t.Failed() {
				t.Logf("source:\n%s", strings.TrimRight(tc.source, "\n"))
			}
		})
	}
}

func equalInts(a, b []int32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
