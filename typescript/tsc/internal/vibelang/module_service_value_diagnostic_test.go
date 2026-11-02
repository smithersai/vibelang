package vibelang

import (
	"strings"
	"testing"
)

func TestModuleServiceValueDiagnostic(t *testing.T) {
	for _, test := range []struct{ name, source, hint string }{
		{"alias", "export function f(p: string) { const fs = FileSystem; fs.writeFileString(p, \"x\") }",
			"Write FileSystem() to read the service implementation, or call FileSystem.writeFileString(...) directly."},
		{"alias chain", "export function f(p: string) { const fs = FileSystem; const other = fs; other.writeFileString(p, \"x\") }",
			"Write FileSystem() to read the service implementation, or call FileSystem.writeFileString(...) directly."},
		{"parameter", "export function f(fs: typeof FileSystem, p: string) { fs.writeFileString(p, \"x\") }",
			"Write FileSystem() to read the service implementation, or call FileSystem.writeFileString(...) directly."},
		{"experimental", "export function f() { const proc = Experimental.Process; return proc.hostname() }",
			"Write Experimental.Process() to read the service implementation, or call Experimental.Process.hostname(...) directly."},
		{"plain service value", "export function f() { const p = Path; return p.sep }",
			"Write Path() to read the service implementation, then read its sep member."},
		{"unknown member", "export function f() { const fs = FileSystem; return fs.notAServiceMember }", ""},
		{"ordinary object", "export function f() { const fs = {}; return fs.writeFileString }", ""},
		{"hatch", "export function f() { return sync(() => { const fs = FileSystem; return fs.writeFileString }) }", ""},
		{"shadowed module", "const fs = FileSystem; export function f(FileSystem: {}) { return fs.writeFileString }", ""},
		{"shadowed namespace", "const proc = Experimental.Process; export function f(Experimental: {}) { return proc.hostname }", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() != 2339 {
					continue
				}
				found = true
				if d.Source() != "" {
					t.Errorf("changed TS2339 source to %q", d.Source())
				}
				text := diagnosticWithNotes(d)
				if test.hint != "" && !strings.Contains(text, test.hint) {
					t.Errorf("missing hint %q in %s", test.hint, text)
				}
				if test.hint == "" && strings.Contains(text, "to read the service implementation") {
					t.Errorf("unrelated missing property received a service hint: %s", text)
				}
			}
			if !found {
				t.Fatal("missing original TS2339")
			}
		})
	}
}
