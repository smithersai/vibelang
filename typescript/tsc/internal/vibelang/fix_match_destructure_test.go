package vibelang

import (
	"testing"
)

// Removing a handler activation must not let var or direct eval observe its
// caller's function environment. An uncertain scope keeps its refusal.
func TestMatchHandlerDestructureScopeRefusals(t *testing.T) {
	for _, test := range []struct{ body, why string }{
		{"{ var privateValue = payload; return privateValue }", "function scope"},
		{"{ return eval('payload') }", "eval"},
		{"{ const read = () => eval('payload'); return read() }", "eval"},
	} {
		source := "export const f = (v:{kind:string;payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = 'empty'}):string => " + test.body + "), Match.orElse(():string => 'miss'))"
		p, f, _, _ := editorProgram(t, source)
		found := false
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			if d.Source() != diagnosticSource || d.Code() != EK4839.Code {
				continue
			}
			found = true
		}
		if !found {
			t.Fatalf("missing scope refusal for %s", source)
		}
	}
}
