package compiler

import (
	"strconv"
	"strings"
	"testing"
)

// Composed provenance keys in the fork bridge.
//
// THE DEFECT THIS FILE EXISTS FOR. `nativeprovenance.go.txt` builds four
// composed string keys by joining components with a punctuation separator, and
// one component of each is a SOURCE FILE NAME, which is author-controlled.
// `virtualFileName` (`main.go.txt`) refuses a compiler input path containing
// `:` and nothing else, so `,`, `|` and `#` — the three separators these joins
// use — are all spellable by an ordinary file on disk, and an export name
// reaching `dependencyThroughStarExports` may hold `#` too (`export { x as
// "a#b" }`). The joins were therefore many-to-one:
//
//	list of ["x.sm:1:2", "y.sm:3:4"]      -> [x.sm:1:2,y.sm:3:4]
//	list of ["x.sm:1:2,y.sm:3:4"]         -> [x.sm:1:2,y.sm:3:4]
//	file "a.sm",   member "b#c"           -> a.sm#b#c
//	file "a.sm#b", member "c"             -> a.sm#b#c
//
// WHAT A COLLISION COSTS. These are not rendered anywhere; they are equality
// keys. `nativeFlowUnionValue` dedups its options by one, so a collision MERGES
// two distinct provenance values and the option set silently shrinks;
// `nativeFlowBindingsKey` memoizes the launder walk on one, so a collision
// returns another binding set's answer; and `dependencyThroughStarExports` uses
// one as its `export *` recursion guard, so a collision reports a cycle that was
// never entered and returns false. All three are fail-OPEN — a foreign or
// untrusted value the analysis stops reporting — which is why an equality key
// being unobservable does not make it exempt from being injective.
//
// WHY THIS TEST IS A SOURCE SCAN. The functions live in a fork PATCH compiled
// into the pinned TypeScript-Go checkout, not into this package, so no test here
// can call them. `TestPinnedForkBridgeByteOrderSortsAreReviewed` has the same
// constraint and answers it the same way: assert the property over the bridge
// source text, so a regression is a build failure rather than a silence.

// composedProvenanceKey is one join in nativeprovenance.go.txt that must be
// self-delimiting, spelled exactly as the source spells it.
type composedProvenanceKey struct {
	function string
	spelling string
}

var composedProvenanceKeys = []composedProvenanceKey{
	{
		function: "nativeFlowValueKey",
		spelling: `parts[index] = nativeKeyPart(nativeFlowValueKey(element))`,
	},
	{
		function: "nativeFlowValueKey",
		spelling: `parts[index] = nativeKeyPart(nativeFlowValueKey(option))`,
	},
	{
		function: "nativeFlowBindingsKey",
		spelling: `values = append(values, nativeKeyPart(nativeFlowValueKey(value)))`,
	},
	{
		function: "nativeFlowBindingsKey",
		spelling: `return nativeKeyPart(nativeFlowValueKey(nativeFlowNodeValue(callee))) + "|" + strings.Join(values, ",")`,
	},
	{
		function: "dependencyThroughStarExports",
		spelling: `key := nativeKeyPart(file.FileName()) + "#" + member`,
	},
}

// RED BEFORE THE FIX: every one of these five spellings was the unprefixed join,
// so each assertion below failed on the shipped bridge.
func TestPinnedForkProvenanceKeysAreSelfDelimiting(t *testing.T) {
	text := string(forkNativeProvenanceSource)
	if !strings.Contains(text, "func nativeKeyPart(part string) string {") {
		t.Fatalf("nativeprovenance.go.txt has no nativeKeyPart; composed provenance keys cannot be self-delimiting without one")
	}
	for _, key := range composedProvenanceKeys {
		if !strings.Contains(text, key.spelling) {
			t.Errorf("%s no longer composes its key as %q.\n"+
				"A composed provenance key joins author-controlled components with punctuation a source "+
				"file name may contain, so every component must carry its own length. Route it through "+
				"nativeKeyPart, or update this census with the reason it is injective without one.",
				key.function, key.spelling)
		}
	}
	// The node case is the one exception, and it is enforced rather than
	// assumed: virtualFileName refuses a `:` in a compiler input path, and the
	// other two components are decimal integers.
	if !strings.Contains(text, `return name + ":" + strconv.Itoa(value.node.Pos()) + ":" + strconv.Itoa(value.node.End())`) {
		t.Errorf("nativeFlowValueKey no longer spells the node key as file:pos:end")
	}
	if !strings.Contains(string(forkBridgeSource), `strings.Contains(logical, ":")`) {
		t.Errorf("virtualFileName no longer refuses a ':' in a compiler input path, which is the whole " +
			"reason nativeFlowValueKey's node case needs no length prefix")
	}
}

// nativeKeyPart's own algebra, kept executable beside the census: the census
// says the bridge USES it, this says what using it buys.
func nativeKeyPartForTest(part string) string { return strconv.Itoa(len(part)) + ":" + part }

func TestProvenanceKeyPartsSurviveASeparatorInAFileName(t *testing.T) {
	joinRaw := func(parts ...string) string { return "[" + strings.Join(parts, ",") + "]" }
	joinPrefixed := func(parts ...string) string {
		prefixed := make([]string, len(parts))
		for index, part := range parts {
			prefixed[index] = nativeKeyPartForTest(part)
		}
		return "[" + strings.Join(prefixed, ",") + "]"
	}

	// Two node keys from two files, against one node key from a file whose name
	// holds the separator. `virtualFileName` accepts both names: neither has a
	// ':' outside the position suffix this join's components already end with.
	two := []string{"/src/x.sm:1:2", "/src/y.sm:3:4"}
	one := []string{"/src/x.sm:1:2,/src/y.sm:3:4"}

	if joinRaw(two...) != joinRaw(one...) {
		t.Fatalf("the shipped join was expected to collide; it did not: %q vs %q", joinRaw(two...), joinRaw(one...))
	}
	if joinPrefixed(two...) == joinPrefixed(one...) {
		t.Fatalf("length-prefixed join still collides: %q", joinPrefixed(two...))
	}

	// And the `#` join, whose second component is an export name.
	if nativeKeyPartForTest("a.sm")+"#"+"b#c" == nativeKeyPartForTest("a.sm#b")+"#"+"c" {
		t.Fatalf("length-prefixed star-export key still collides")
	}
	if "a.sm"+"#"+"b#c" != "a.sm#b"+"#"+"c" {
		t.Fatalf("the shipped star-export join was expected to collide; it did not")
	}
}
