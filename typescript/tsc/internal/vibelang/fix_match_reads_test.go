package vibelang

import (
	"testing"
)

// RC-16: textual declaration order alone cannot establish initialization
// across a function activation, a class initializer, or a module cycle.
func TestMatchLiteralBindingInitializationRefusals(t *testing.T) {
	for _, source := range []string{
		"const ready=2; export function f(n:number):string { return Match.value(n).pipe(Match.when(ready,():string=>'hit'),Match.orElse(():string=>'miss')) }",
		"export function f(n:number):string { return Match.value(n).pipe(Match.when(1,():string=>'first'),Match.when(ready,():string=>'hit'),Match.orElse(():string=>'miss')) }; const ready=2;",
		"export function f(n:number):string { class C { value:string=Match.value(n).pipe(Match.when(ready,():string=>'hit'),Match.orElse(():string=>'miss')) }; const ready=2; return new C().value }",
	} {
		assertFormRefusal(t, source, 4839, "has no match pattern")
	}
}
