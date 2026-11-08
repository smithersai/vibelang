package vibelang

import (
	"strings"
	"testing"
)

var statementHomeTests = []struct{ name, body string }{
	{"if", "if (true) BODY"},
	{"else", "if (false) {} else BODY"},
	{"for", "for (let i=0;i<1;i++) BODY"},
	{"for-of", "for (const x of [1,2]) BODY"},
	{"for-in", "for (const x in {a:1}) BODY"},
	{"while", "while (false) BODY"},
	{"do-while", "do BODY while (false)"},
	{"label", "label: BODY"},
	{"nested", "for (const x of [1,2]) if (true) BODY"},
	{"else-if", "if (false) {} else if (1 is let id) void id"},
	{"return", "if (true) return (1 is let id) ? id : 0"},
	{"throw", "if (false) throw (1 is let id) ? id : 0"},
	{"expression", "if (true) void (1 is let id)"},
	{"comment", "if (true) /* keep */ BODY // tail\n"},
}

func TestIsStatementHomeRejection(t *testing.T) {
	for _, tc := range statementHomeTests {
		t.Run(tc.name, func(t *testing.T) {
			source := "export function f() { " + strings.ReplaceAll(tc.body, "BODY", "if (1 is let id) void id") + "; return 0 }"
			if tc.name == "throw" {
				source = strings.Replace(source, "export function", "export effect function", 1)
			}
			p, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				found = found || d.Code() == 705
			}
			if !found {
				t.Fatalf("missing EK0705 in %s", source)
			}
		})
	}
}

func TestIsStatementHomeControls(t *testing.T) {
	for _, source := range []string{
		"function f(){if(1 is let id) return id;return 0}",
		"function f(){for(const x of [1,2]) {if(x is let id) void id}}",
		"function f(){if(true) void do {const ok=1 is let id;ok}}",
		"function f(){if(true) void (()=>1 is let id)}",
		"function f(){if(true) void (1 is Number)}",
		"function f(){if(true) for(let i=(1 is let id)?id:0;i<1;i++) void i}",
	} {
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("control: %v\n%s", ds, source)
		}
	}
}
