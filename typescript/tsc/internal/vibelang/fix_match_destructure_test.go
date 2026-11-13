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
		assertFormRefusal(t, source, 4839, test.why)
	}
}
