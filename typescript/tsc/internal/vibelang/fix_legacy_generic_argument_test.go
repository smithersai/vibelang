package vibelang

import (
	"strings"
	"testing"
)

// A call passed where an unconstrained type parameter stands ran before VIP-1.
// The parameter's instantiated type is the argument's own Effect, which read as
// "expects a program", so --fix-vip-only wrote no try. Nothing failed to compile;
// the callee got the program (Smithers agent/fs Incur.test.vibe, 9 of 58 tests:
// expected { _id: 'Effect', op: 'Suspend' } to deeply equal [ '/review' ]).
func TestFixVIPRunsCallAtBareGenericParameter(t *testing.T) {
	for _, signature := range []string{
		"declare function check<T>(actual: T, message?: string): T",
		"declare function check<T>(actual: T): T",
		"declare function check<T, U = string>(actual: T, other?: U): T",
		"declare function check<T>(actual: T, ...rest: Array<string>): T",
		"declare function check<T extends unknown>(actual: T, message?: string): T",
	} {
		t.Run(signature, func(t *testing.T) {
			prelude := legacyRunsPrelude + signature + "\n\n"
			source := prelude + "export effect function f() {\n  return check(load(1))\n}\n"
			want := prelude + "export effect function f() {\n  return check(try load(1))\n}\n"
			result, name := fixVIPOnlySource(t, source)
			fixed := result.Files[name]
			if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
				t.Fatalf("--fix-vip-only wrote %+v, want\n%s\nrefused %+v", fixed, want, result.Refused)
			}
		})
	}
}

// A parameter that asks for an Effect still holds its program, generic or not.
func TestFixVIPHoldsCallAtEffectParameter(t *testing.T) {
	for _, signature := range []string{
		"declare function check<A>(program: A!!, message?: string): A",
		"declare function check<T extends Effect.Effect<unknown>>(program: T, message?: string): T",
	} {
		t.Run(signature, func(t *testing.T) {
			source := legacyRunsPrelude + signature + "\n\nexport effect function f() {\n  return check(load(1))\n}\n"
			result, name := fixVIPOnlySource(t, source)
			if fixed := result.Files[name]; fixed != nil && strings.Contains(fixed.Text, "try load(1)") {
				t.Fatalf("--fix-vip-only ran a held program:\n%s", fixed.Text)
			}
		})
	}
}

// Explicit type arguments choose the program type independently of inference
// from the call being migrated (D44).
func TestFixVIPHoldsCallAtExplicitGenericParameter(t *testing.T) {
	source := legacyRunsPrelude + "declare function check<T>(actual: T, message?: string): T\n\nexport effect function f() {\n  const program: number!! = check<number!!>(load(1))\n  return try program\n}\n"
	result, name := fixVIPOnlySource(t, source)
	if fixed := result.Files[name]; fixed != nil && strings.Contains(fixed.Text, "try load(1)") {
		t.Fatalf("--fix-vip-only ran a program selected by an explicit type argument:\n%s", fixed.Text)
	}
	if len(result.Refused) != 0 {
		t.Fatalf("explicit Effect parameter refused: %+v", result.Refused)
	}
}
