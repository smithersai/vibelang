package compiler

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The Result member surface exists in two places that no build step connects.
//
// The reference frontend declares it once, as RESULT_MEMBER_SIGNATURES in
// poc/src/language/semantic.ts, and derives BOTH of its walks from that table —
// the checker prelude that admits a member and the ownership walk that lets it
// discharge a must-use obligation. It reached that state by collapsing two
// hand-maintained lists written 6000 lines apart, after `flatten` and `tapBoth`
// were found implemented, tested, documented as required, and unreachable from
// authored `.sm`, because neither list had learned them and the refusal was
// SMITHERS1301 ("Result value is not consumed") rather than an unknown property.
//
// The fork carries its own copy, and it cannot be collapsed into the
// reference's: `resultConsumerMembers` in compiler/forkbridge/lowering.go.txt is
// Go source compiled into a foreign checkout, and the two prelude classes beside
// it are TypeScript inside a Go string literal. Nothing there can read a
// TypeScript module in this repository at build time.
//
// So the copy is PINNED rather than removed, in the shape
// conformance/identity/*.json already uses for the two independently minted
// identity algorithms: the two sides are asserted against each other here,
// where a divergence is a red test, instead of against nothing, where a
// divergence is a silently unreachable member on one backend.
//
// This test reads text. It deliberately does not compile anything: the fork's
// own runtime assertion
// (`len(resultConsumerDecls) != 2*len(resultConsumerMembers)`) already refuses
// to start when the list and the classes disagree, and every compiling test in
// this package would fail with "the compiler-owned prelude is incomplete" if it
// did. What no compiling test can see is the fork agreeing with ITSELF while
// disagreeing with the reference, which is exactly the state that produced the
// two `xfail(go)` markers this test retires.

// resultMemberSurfaceUnwrap is the one member the prelude classes implement that
// is NOT part of the surface. `unwrap` is the runtime's missed-lowering
// fallback: the compiler emits an early Result return for postfix `!`, the
// authored spelling is refused as SMITHERS1206 by the retired-syntax rule, and
// `expect` is the sanctioned panicking form. It is therefore expected on the
// classes and forbidden from the discharge set, and both halves are asserted.
const resultMemberSurfaceUnwrap = "unwrap"

// TestForkResultMemberSurfaceMatchesTheReference is the drift guard. It fails
// when a member is added to (or removed from) either side alone.
func TestForkResultMemberSurfaceMatchesTheReference(t *testing.T) {
	lowering := readTextFile(t, "forkbridge/lowering.go.txt")
	semantic := readTextFile(t, "../poc/src/language/semantic.ts")

	reference := referenceResultMemberNames(t, semantic)
	fork := forkResultConsumerMembers(t, lowering)

	if len(reference) == 0 {
		t.Fatal("RESULT_MEMBER_SIGNATURES parsed as empty; the reference table moved or changed shape")
	}
	if strings.Join(reference, " ") != strings.Join(fork, " ") {
		t.Fatalf("the Result member surface has drifted between the two backends.\n"+
			"  reference (poc/src/language/semantic.ts, RESULT_MEMBER_SIGNATURES): %v\n"+
			"  fork      (compiler/forkbridge/lowering.go.txt, resultConsumerMembers): %v\n"+
			"a member on one list and not the other is unreachable from authored .sm on that backend, "+
			"and the refusal is SMITHERS1301 rather than an unknown property, so nothing else goes red",
			reference, fork)
	}
	for _, name := range fork {
		if name == resultMemberSurfaceUnwrap {
			t.Fatalf("%q is in the discharge set; it is the runtime's missed-lowering fallback and "+
				"the authored spelling is refused as SMITHERS1206", resultMemberSurfaceUnwrap)
		}
	}
}

// TestForkPreludeClassesDeclareExactlyTheResultMemberSurface closes the second
// half of the fork's own two-part edit. The list above says which members
// discharge; these two classes are what an authored program actually calls, and
// the fork refuses to start unless every listed name is declared on both. What
// the startup assertion counts but cannot name is the reverse direction — a
// method declared on the classes that no list admits, which type-checks at the
// call site and then fails the must-use walk.
func TestForkPreludeClassesDeclareExactlyTheResultMemberSurface(t *testing.T) {
	lowering := readTextFile(t, "forkbridge/lowering.go.txt")
	prelude := forkPreludeText(t, lowering)
	fork := forkResultConsumerMembers(t, lowering)

	want := append(append([]string{}, fork...), resultMemberSurfaceUnwrap)
	for _, class := range []string{"SmithersOk<A>", "SmithersErr<E>"} {
		declared := preludeClassMethodNames(t, prelude, class)
		if !sameNameSet(declared, want) {
			t.Fatalf("%s declares %v; the discharge set plus %q is %v",
				class, declared, resultMemberSurfaceUnwrap, want)
		}
	}
}

// TestForkPreludeFlattenSignatureIsShared pins the reason the two `flatten`
// declarations are byte-identical rather than each specialised to its variant.
//
// `.flatten()` is called on the `SmithersOk | SmithersErr` union, and the
// checker forms a union call signature by INTERSECTING the constituents' `this`
// types. Two different `this` types intersect into a type the receiver is not
// assignable to, and every authored call site then fails with TS2684 — a
// failure that looks nothing like the edit that caused it. One shared signature
// intersects with itself. A later lane "tidying" the two into per-variant
// spellings breaks every `.flatten()` call in the corpus, so the requirement is
// written down here instead of only in a comment.
func TestForkPreludeFlattenSignatureIsShared(t *testing.T) {
	prelude := forkPreludeText(t, readTextFile(t, "forkbridge/lowering.go.txt"))
	signatures := []string{}
	for _, class := range []string{"SmithersOk<A>", "SmithersErr<E>"} {
		body := preludeClassBody(t, prelude, class)
		index := strings.Index(body, "flatten<")
		if index < 0 {
			t.Fatalf("%s no longer declares flatten", class)
		}
		open := strings.Index(body[index:], "{")
		if open < 0 {
			t.Fatalf("%s declares an unterminated flatten", class)
		}
		signatures = append(signatures, strings.TrimSpace(body[index:index+open]))
	}
	if signatures[0] != signatures[1] {
		t.Fatalf("the two flatten signatures diverged; a union call intersects the `this` types, "+
			"so they must be identical:\n  SmithersOk: %s\n  SmithersErr: %s", signatures[0], signatures[1])
	}
}

func readTextFile(t *testing.T, path string) string {
	t.Helper()
	text, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(text)
}

var goStringLiteral = regexp.MustCompile(`"((?:[^"\\]|\\.)*)"`)

// referenceResultMemberNames derives the member names from the reference's
// signature table the same way the reference itself does: the text before the
// signature's type-parameter list or parameter list, whichever comes first.
func referenceResultMemberNames(t *testing.T, semantic string) []string {
	t.Helper()
	const marker = "const RESULT_MEMBER_SIGNATURES: readonly string[] = ["
	start := strings.Index(semantic, marker)
	if start < 0 {
		t.Fatal("RESULT_MEMBER_SIGNATURES is gone from poc/src/language/semantic.ts")
	}
	body := semantic[start+len(marker):]
	end := strings.Index(body, "\n];")
	if end < 0 {
		t.Fatal("RESULT_MEMBER_SIGNATURES is unterminated")
	}
	names := []string{}
	for _, line := range strings.Split(body[:end], "\n") {
		if trimmed := strings.TrimSpace(line); strings.HasPrefix(trimmed, "//") {
			continue
		}
		for _, match := range goStringLiteral.FindAllStringSubmatch(line, -1) {
			signature, err := strconv.Unquote(`"` + match[1] + `"`)
			if err != nil {
				t.Fatalf("unparsable signature literal %q: %v", match[1], err)
			}
			cut := strings.IndexAny(signature, "<(")
			if cut <= 0 {
				t.Fatalf("unparsable Result member signature: %q", signature)
			}
			names = append(names, signature[:cut])
		}
	}
	return names
}

func forkResultConsumerMembers(t *testing.T, lowering string) []string {
	t.Helper()
	const marker = "var resultConsumerMembers = []string{"
	start := strings.Index(lowering, marker)
	if start < 0 {
		t.Fatal("resultConsumerMembers is gone from compiler/forkbridge/lowering.go.txt")
	}
	body := lowering[start+len(marker):]
	end := strings.Index(body, "}")
	if end < 0 {
		t.Fatal("resultConsumerMembers is unterminated")
	}
	names := []string{}
	for _, match := range goStringLiteral.FindAllStringSubmatch(body[:end], -1) {
		names = append(names, match[1])
	}
	return names
}

// forkPreludeText is the TypeScript the fork injects into every internally
// lowered project, read out of the Go raw string literal that holds it.
func forkPreludeText(t *testing.T, lowering string) string {
	t.Helper()
	const marker = "const preludeText = `"
	start := strings.Index(lowering, marker)
	if start < 0 {
		t.Fatal("preludeText is gone from compiler/forkbridge/lowering.go.txt")
	}
	body := lowering[start+len(marker):]
	end := strings.Index(body, "`")
	if end < 0 {
		t.Fatal("preludeText is unterminated")
	}
	return body[:end]
}

// preludeClassBody is the text between a prelude class's opening brace and the
// `}` that closes it at column zero. The prelude indents every member, so a
// closing brace in the first column is the class's own.
func preludeClassBody(t *testing.T, prelude string, class string) string {
	t.Helper()
	marker := "export class " + class + " {\n"
	start := strings.Index(prelude, marker)
	if start < 0 {
		t.Fatalf("the prelude no longer declares class %s", class)
	}
	body := prelude[start+len(marker):]
	end := strings.Index(body, "\n}")
	if end < 0 {
		t.Fatalf("class %s is unterminated", class)
	}
	return body[:end]
}

// preludeMethodDeclaration matches a member declaration at the top level of a
// class body: a name, an optional type-parameter list, then the parameter list.
var preludeMethodDeclaration = regexp.MustCompile(`^([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^(]*>)?\(`)

// preludeClassMethodNames lists the methods a prelude class declares, counting
// only declarations at the top level of the class body. Nesting is tracked with
// a brace count rather than with indentation, because the prelude mixes tabs
// and spaces and an indentation rule would silently miscount a reformatted line.
func preludeClassMethodNames(t *testing.T, prelude string, class string) []string {
	t.Helper()
	names := []string{}
	depth := 0
	for _, line := range strings.Split(preludeClassBody(t, prelude, class), "\n") {
		trimmed := strings.TrimSpace(line)
		if depth == 0 && !strings.HasPrefix(trimmed, "//") {
			if match := preludeMethodDeclaration.FindStringSubmatch(trimmed); match != nil {
				names = append(names, match[1])
			}
		}
		if strings.HasPrefix(trimmed, "//") {
			continue
		}
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		if depth < 0 {
			t.Fatalf("class %s has unbalanced braces at %q", class, trimmed)
		}
	}
	if depth != 0 {
		t.Fatalf("class %s has unbalanced braces", class)
	}
	// `constructor` is a declaration but not a member of the callable surface.
	kept := names[:0]
	for _, name := range names {
		if name != "constructor" {
			kept = append(kept, name)
		}
	}
	return kept
}

func sameNameSet(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	seen := map[string]int{}
	for _, name := range left {
		seen[name]++
	}
	for _, name := range right {
		seen[name]--
	}
	for _, count := range seen {
		if count != 0 {
			return false
		}
	}
	return true
}
