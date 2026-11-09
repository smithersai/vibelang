package vibelang

import (
	"strings"
	"testing"
)

// EK3004 for a class pattern suggests matching a member the service has.
func TestServiceClassPatternNamesOwnMember(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"body member", "export service Flags {\n static readonly key = \"pattern/Flags\"\n region: string\n}\ndeclare const impl: unknown\nexport const m = match (impl) { when Flags: 1; default: 0; }\n", "when { region: let region }"},
		{"method before property", "export service Users {\n static readonly key = \"pattern/Users\"\n find(id: string): string!!\n region: string\n}\ndeclare const impl: unknown\nexport const m = match (impl) { when Users(let u): 1; default: 0; }\n", "when { find: let find }"},
		{"whole shape", "type Shape = { readonly value: number }\nexport service Port: Shape { static readonly key = \"pattern/Port\" }\ndeclare const impl: unknown\nexport const m = match (impl) { when Port: 1; default: 0; }\n", "when { value: let value }"},
		{"symbol-keyed only", "export service Iter {\n static readonly key = \"pattern/Iter\";\n [Symbol.iterator](): Iterator<number>\n}\ndeclare const impl: unknown\nexport const m = match (impl) { when Iter: 1; default: 0; }\n", "when { member: let member }"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			found := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == 3004 {
					found++
					if !strings.Contains(d.String(), tc.want) {
						t.Errorf("want %q in %s", tc.want, d.String())
					}
				}
			}
			if found != 1 {
				t.Fatalf("want one EK3004, got %d", found)
			}
		})
	}
}
