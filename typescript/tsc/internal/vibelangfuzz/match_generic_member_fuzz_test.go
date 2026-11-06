package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const genericMemberDomainQuote = "A constrained type parameter uses its finite constraint as a conservative domain"
const genericMemberCoverageQuote = "Coverage is per normalized member and tag case"
const genericMemberTarget = "FuzzGenericTaggedMemberCoverage"

func genericMemberCoverageQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{genericMemberDomainQuote, genericMemberCoverageQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("generic tag coverage rule changed: %s", quote)
		}
	}
}

func TestGenericTaggedMemberCoverageQuoted(t *testing.T) { genericMemberCoverageQuotes(t) }

var genericMemberDomains = []struct{ key, typ, first, second string }{
	{"string", `"A"|"B"`, `"A"`, `"B"`},
	{"number", `1|2`, `1`, `2`},
	{"bigint", `1n|2n`, `1n`, `2n`},
	{"boolean", `boolean`, `true`, `false`},
}

// The chapter counts each tag case even when the whole constrained object
// retains its type. Mutations exercise omission, guards, payload presence,
// captures, alternatives, chained constraints and source function contexts.
func FuzzGenericTaggedMemberCoverage(f *testing.F) {
	startShortBudget(f)
	genericMemberCoverageQuotes(f)
	for _, domain := range genericMemberDomains {
		for shape := uint8(0); shape < 8; shape++ {
			f.Add(domain.key, shape, shape)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape, context uint8) {
		index := slices.IndexFunc(genericMemberDomains, func(d struct{ key, typ, first, second string }) bool { return d.key == key })
		if index < 0 {
			index = int(shape) % len(genericMemberDomains)
		}
		d := genericMemberDomains[index]
		domain := fmt.Sprintf("{_tag:%s}", d.typ)
		first, second := fmt.Sprintf("{_tag:%s}", d.first), fmt.Sprintf("{_tag:%s}", d.second)
		want := 0
		switch shape % 8 {
		case 1:
			want = 1
		case 2:
			domain = fmt.Sprintf("{_tag:%s;value:number}", d.typ)
			first, second = fmt.Sprintf("{_tag:%s,let value}", d.first), fmt.Sprintf("{_tag:%s,const value}", d.second)
		case 3:
			domain = fmt.Sprintf("{_tag:%s;value?:number}", d.typ)
			first, second = fmt.Sprintf("{_tag:%s,let value}", d.first), fmt.Sprintf("{_tag:%s,const value}", d.second)
			want = 1
		case 4:
			first += " and if(flag)"
			want = 1
		case 5:
			first = "(" + first + ") or (" + second + ")"
		case 6:
			first = "(" + first + ") and let captured"
			second = "const captured and (" + second + ")"
		case 7:
			domain = fmt.Sprintf("{_tag:%s;left:number}|{_tag:%s;right:number}", d.first, d.first)
		}
		arms := "when " + first + ":1;"
		if shape%8 != 1 && shape%8 != 5 && shape%8 != 7 {
			arms += "when " + second + ":2;"
		}
		params := "T extends " + domain
		if context&4 != 0 {
			params = "U extends " + domain + ",T extends U"
		}
		modifier := ""
		switch context % 3 {
		case 1:
			modifier = "effect "
		case 2:
			modifier = "async "
		}
		source := fmt.Sprintf("export %sfunction check<%s>(s:T,flag:boolean){return match(s){%s}}", modifier, params, arms)
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
				Gap(t, genericMemberTarget, "diagnostic:"+key, "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
			count++
		}
		if count != want {
			Gap(t, genericMemberTarget, fmt.Sprintf("coverage:%s:%d", key, shape%8), "%s; %s: got %d EK4701, want %d\n%s", genericMemberDomainQuote, genericMemberCoverageQuote, count, want, source)
		}
	})
}
