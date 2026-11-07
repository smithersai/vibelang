package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const brandedDomainTarget = "FuzzBrandedPrimitiveMatchDomain"
const brandedDomainQuote = "A member is tagged when it is an object, interface or class instance"
const brandedConstraintQuote = "an unconstrained parameter or a broad constraint stays open."

func brandedDomainQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{brandedDomainQuote, brandedConstraintQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("match domain authority changed: %s", quote)
		}
	}
}
func TestBrandedPrimitiveMatchDomainQuoted(t *testing.T) { brandedDomainQuotes(t) }

var brandedDomainKeys = []string{"string", "number", "boolean", "bigint", "symbol", "object", "String", "Number", "Boolean"}

// An intersection's primitive constituent stays primitive. Object and boxed
// object intersections retain their finite tag cases as separate controls.
func FuzzBrandedPrimitiveMatchDomain(f *testing.F) {
	startShortBudget(f)
	brandedDomainQuotes(f)
	for _, key := range brandedDomainKeys {
		for context := uint8(0); context < 4; context++ {
			f.Add(key, context)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, context uint8) {
		index := slices.Index(brandedDomainKeys, key)
		if index < 0 {
			index = int(context) % len(brandedDomainKeys)
			key = brandedDomainKeys[index]
		}
		base := key
		if key == "object" {
			base = "{field:number}"
		}
		domain := base + `&{readonly _tag:"P"}`
		if context&2 != 0 {
			domain = `{readonly _tag:"P"}&` + base
		}
		parameters, subject := "", "S"
		if context&1 != 0 {
			parameters = "<T extends S>"
			subject = "T"
		}
		source := "type P=" + domain + `;type S=P|{_tag:"O"};` + fmt.Sprintf(`export function f%s(s:%s){return match(s){when {_tag:"O"}:1;}}`, parameters, subject)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() == 4701 {
				count++
			} else {
				Gap(t, brandedDomainTarget, fmt.Sprintf("diagnostic:%s:%d", key, context%4), "unexpected %s\n%s", specDiagnosticText(d), source)
				return
			}
		}
		want := 0
		if index >= 5 {
			want = 1
		}
		if count != want {
			Gap(t, brandedDomainTarget, fmt.Sprintf("domain:%s:%d", key, context%4), "%s: got %d EK4701, want %d\n%s", brandedDomainQuote, count, want, source)
		}
	})
}
