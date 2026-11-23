package vibelang

import (
	"testing"
)

func TestMatchWarningWithDestructuredHandlers(t *testing.T) {
	for _, test := range []struct{ body string }{
		{"{ var privateValue = payload; return privateValue }"},
		{"{ return eval('payload') }"},
		{"{ const read = () => eval('payload'); return read() }"},
	} {
		source := "export const f = (v:{kind:string;payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = 'empty'}):string => " + test.body + "), Match.orElse(():string => 'miss'))"
		assertMatchFormWarning(t, source)
	}
}
