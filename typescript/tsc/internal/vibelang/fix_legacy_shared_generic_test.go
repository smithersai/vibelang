package vibelang

import (
	"strings"
	"testing"
)

func TestFixVIPGenericOtherArgumentHoldsProgram(t *testing.T) {
	source := legacyRunsPrelude + "declare function check<T>(actual: T, other: T): T\n\nconst other = Effect.succeed(2)\n\nexport effect function f() {\n  return check(load(1), other)\n}\n"
	result, name := fixVIPOnlySource(t, source)
	fixed := result.Files[name]
	if fixed == nil || len(result.Refused) != 0 || !strings.Contains(fixed.Text, "return try check(load(1), other)") {
		t.Fatalf("a sibling argument's Effect type must keep the programs held: fixed=%+v refused=%+v", fixed, result.Refused)
	}
}

func TestFixVIPGenericSiblingFormsHoldPrograms(t *testing.T) {
	for _, test := range []struct{ name, parameter, other string }{
		{"optional", "other?: T", "Effect.succeed(2)"},
		{"record", "other: { value: T }", "{ value: Effect.succeed(2) }"},
		{"array", "other: readonly T[]", "[Effect.succeed(2)]"},
		{"tuple", "other: readonly [T]", "[Effect.succeed(2)] as const"},
		{"callback", "other: () => T", "() => Effect.succeed(2)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := legacyRunsPrelude + "declare function check<T>(actual: T, " + test.parameter + "): T\n\nconst other = " + test.other + "\n\nexport effect function f() {\n  return check(load(1), other)\n}\n"
			result, name := fixVIPOnlySource(t, source)
			fixed := result.Files[name]
			if fixed == nil || len(result.Refused) != 0 || !strings.Contains(fixed.Text, "return try check(load(1), other)") {
				t.Fatalf("sibling form %s lost its independent context: fixed=%+v refused=%+v", test.name, fixed, result.Refused)
			}
		})
	}
}

func TestFixVIPGenericPlainSiblingDoesNotHoldProgram(t *testing.T) {
	for _, test := range []struct{ name, signature, other string }{
		{"plain", "declare function check<T>(actual: T, other: T): T", "2"},
		{"record", "declare function check<T>(actual: T, other: {value: T}): T", "{value: 2}"},
		{"different parameter", "declare function check<T, U>(actual: T, other: U): T", "Effect.succeed(2)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := legacyRunsPrelude + test.signature + "\n\nconst other = " + test.other + "\n\nexport effect function f() {\n  return check(load(1), other)\n}\n"
			result, name := fixVIPOnlySource(t, source)
			fixed := result.Files[name]
			if fixed == nil || len(result.Refused) != 0 || !strings.Contains(fixed.Text, "return check(try load(1), other)") {
				t.Fatalf("plain or unrelated sibling held the argument: fixed=%+v refused=%+v", fixed, result.Refused)
			}
		})
	}
}
