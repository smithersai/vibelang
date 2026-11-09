package vibelangmapper

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// Chapter 004, Patterns: String, Number, Boolean, BigInt and Symbol "extract
// `[s]` for a primitive and `[s.valueOf()]` for a boxed object", so the
// binding of `String(let t)` has the primitive type, `t`: `string`. The
// compiler types it so through its checker hooks; the projection's stock
// TypeScript must agree through the runtime's $extract signature.
const matchPrimitiveExtractionQuote = "extract `[s]` for a primitive and `[s.valueOf()]` for a boxed object"

func TestMatchPrimitiveExtractorQuoted(t *testing.T) {
	chapter, err := os.ReadFile("../../../../docs/design/src/004-match.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), matchPrimitiveExtractionQuote) {
		t.Fatalf("Chapter 004 no longer says %q; review the primitive extraction types", matchPrimitiveExtractionQuote)
	}
}

var matchPrimitiveExtractors = []struct{ name, primitive string }{
	{"String", "string"}, {"Number", "number"}, {"Boolean", "boolean"}, {"BigInt", "bigint"}, {"Symbol", "symbol"},
}

// matchPrimitiveExtractorPositions puts the extractor pattern where a match
// arm can hold it: the subject, an object property, a computed property, an
// array element and a nested extractor.
var matchPrimitiveExtractorPositions = map[string]struct{ subject, pattern string }{
	"subject":  {"s: unknown", "%s(let value)"},
	"property": {"s: {value: unknown}", "{value: %s(let value)}"},
	"computed": {"s: {value: unknown}", "{[key]: %s(let value)}"},
	"element":  {"s: readonly unknown[]", "[%s(let value)]"},
	"nested":   {"s: {value: readonly unknown[]}", "{value: [%s(let value)]}"},
}

// matchPrimitiveExtractorSubjects widen or narrow the subject at the pattern.
var matchPrimitiveExtractorSubjects = map[string]string{
	"unknown": "unknown",
	"boxed":   "(string | String | number | Number | boolean | Boolean | bigint | BigInt | symbol | Symbol)",
	"any":     "any",
}

// matchPrimitiveExtractorProgram writes one function per primitive class
// whose arm returns the binding as that primitive, or undefined.
func matchPrimitiveExtractorProgram(position, subject string) string {
	var b strings.Builder
	b.WriteString("const key = \"value\";\n")
	for _, p := range matchPrimitiveExtractors {
		shape := strings.Replace(matchPrimitiveExtractorPositions[position].subject, "unknown", matchPrimitiveExtractorSubjects[subject], 1)
		pattern := fmt.Sprintf(matchPrimitiveExtractorPositions[position].pattern, p.name)
		fmt.Fprintf(&b, "export function %s%s(%s): %s | undefined { return match(s) { when %s: value; default: undefined; } }\n",
			strings.ToLower(p.name), strings.ToUpper(position[:1])+position[1:], shape, p.primitive, pattern)
	}
	return b.String()
}

func checkMatchPrimitiveExtractorStock(t *testing.T, position, subject string) {
	t.Helper()
	source := matchPrimitiveExtractorProgram(position, subject)
	decl, output, err := catchTagStock(t, source)
	if err != nil {
		t.Fatalf("stock TypeScript rejected a primitive extractor binding: %v\n%s\n%s", err, output, source)
	}
	for _, p := range matchPrimitiveExtractors {
		want := "): " + p.primitive + " | undefined;"
		if !strings.Contains(decl, strings.ToLower(p.name)+strings.ToUpper(position[:1])+position[1:]+"(") || !strings.Contains(decl, want) {
			t.Fatalf("missing public declaration of the %s extractor binding as %s:\n%s", p.name, p.primitive, decl)
		}
	}
}

func TestMatchPrimitiveExtractorStock(t *testing.T) {
	TestMatchPrimitiveExtractorQuoted(t)
	for position := range matchPrimitiveExtractorPositions {
		t.Run(position, func(t *testing.T) { checkMatchPrimitiveExtractorStock(t, position, "unknown") })
	}
}

// Each input names a position and a subject type; an unknown name is skipped,
// so the saved corpus keeps its meaning when the tables grow.
func FuzzMatchPrimitiveExtractorStock(f *testing.F) {
	f.Add("subject", "boxed")
	f.Add("property", "any")
	f.Add("computed", "unknown")
	f.Add("element", "boxed")
	f.Add("nested", "any")
	f.Fuzz(func(t *testing.T, position, subject string) {
		if _, ok := matchPrimitiveExtractorPositions[position]; !ok {
			t.Skip("unknown position")
		}
		if _, ok := matchPrimitiveExtractorSubjects[subject]; !ok {
			t.Skip("unknown subject")
		}
		checkMatchPrimitiveExtractorStock(t, position, subject)
	})
}
