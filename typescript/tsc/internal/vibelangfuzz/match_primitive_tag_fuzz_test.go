package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const primitiveTagTarget = "FuzzPrimitiveWrapperTagCoverage"
const primitiveTagQuote = "A member is tagged when it is an object, interface or class instance"
const primitiveObjectQuote = "first rejects non-objects (functions are objects too)"

func primitiveTagQuotes(t testing.TB) {
	t.Helper()
	for _, q := range []string{primitiveTagQuote, primitiveObjectQuote} {
		if !strings.Contains(SpecText("004-match.md"), q) {
			t.Fatalf("primitive object-pattern rule changed: %s", q)
		}
	}
}
func TestPrimitiveWrapperTagCoverageQuoted(t *testing.T) { primitiveTagQuotes(t) }

var primitiveTagDomains = []struct{ key, typ, arms, prefix string }{
	{"String", `"a"|"b"`, `when "a":2;when "b":3;`, ""},
	{"Number", "1|2", `when 1:2;when 2:3;`, ""},
	{"Boolean", "boolean", `when true:2;when false:3;`, ""},
	{"BigInt", "1n|2n", `when 1n:2;when 2n:3;`, ""},
	{"Symbol", "typeof A|typeof B", `when A:2;when B:3;`, "declare const A:unique symbol;declare const B:unique symbol;"},
}

// Augmenting a primitive wrapper changes property lookup types, never the
// object-pattern admission test. Exercise finite primitive/object mixtures,
// explicit literal coverage, defaults, boxing, generics and effect contexts.
func FuzzPrimitiveWrapperTagCoverage(f *testing.F) {
	startShortBudget(f)
	primitiveTagQuotes(f)
	for _, d := range primitiveTagDomains {
		for shape := uint8(0); shape < 5; shape++ {
			f.Add(d.key, shape, shape)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape, context uint8) {
		index := slices.IndexFunc(primitiveTagDomains, func(d struct{ key, typ, arms, prefix string }) bool { return d.key == key })
		if index < 0 {
			index = int(shape) % len(primitiveTagDomains)
		}
		d := primitiveTagDomains[index]
		prefix := fmt.Sprintf("export {};declare global{interface %s{readonly _tag:\"Only\"}};", d.key) + d.prefix
		typ := d.typ + `|{_tag:"Only"}`
		params, tail := "", ""
		want := 1
		switch shape % 5 {
		case 1:
			tail = d.arms
			want = 0
		case 2:
			tail = "default:0;"
			want = 0
		case 3:
			params = "<T extends " + typ + ">"
			typ = "T"
		case 4:
			typ = d.key
			want = 0
		}
		modifier := ""
		if context&1 != 0 {
			modifier = "effect "
		}
		if context&2 != 0 && shape%5 != 4 {
			prefix = d.prefix + "export {};"
		}
		source := prefix + fmt.Sprintf("export %sfunction f%s(s:%s){return match(s){when {_tag:\"Only\"}:1;%s}}", modifier, params, typ, tail)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if diagnosticKey(d) != "EK4701" {
				Gap(t, primitiveTagTarget, "diagnostic:"+key, "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
			count++
		}
		if count != want {
			Gap(t, primitiveTagTarget, fmt.Sprintf("coverage:%s:%d", key, shape%5), "%s; %s: got %d EK4701, want %d\n%s", primitiveTagQuote, primitiveObjectQuote, count, want, source)
		}
	})
}
