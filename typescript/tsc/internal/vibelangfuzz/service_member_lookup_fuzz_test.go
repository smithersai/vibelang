package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var serviceLookupQuotes = []struct{ chapter, quote string }{
	{"005-services.md", "There is no `Users.find(id)` shorthand"},
	{"../vips/0010-service-call-shorthand-denied.md", "There is no shorthand: get the service, then call it."},
	{"../vips/0010-service-call-shorthand-denied.md", "Class statics collide with member names"},
}

func serviceLookupQuoted(t testing.TB) {
	t.Helper()
	for _, q := range serviceLookupQuotes {
		text, err := os.ReadFile(SpecPath(q.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), q.quote) {
			t.Fatalf("%s no longer says %q", q.chapter, q.quote)
		}
	}
}
func TestServiceMemberLookupQuoted(t *testing.T) { serviceLookupQuoted(t) }

var serviceLookupRules = []string{"effect-call", "held-call", "plain-call", "member-value", "static-name", "static-key", "explicit-effect", "explicit-plain"}

// Static VIP-10 neighbourhood: tried and held calls, a plain-returning
// implementation method, extracted values, class/key collisions, and their
// explicit lookup controls. Mutations vary the written key and member name.
func FuzzServiceMemberLookup(f *testing.F) {
	startShortBudget(f)
	serviceLookupQuoted(f)
	for _, key := range serviceLookupRules {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, variant := 0, 0
		if len(data) > 0 {
			choice = int(data[0]) % len(serviceLookupRules)
		}
		if len(data) > 1 {
			variant = int(data[1]) % 4
		}
		for i, key := range serviceLookupRules {
			if string(data) == key {
				choice = i
				variant = 0
				break
			}
		}
		key := serviceLookupRules[choice]
		member := []string{"find", "lookup", "read", "query"}[variant]
		body := ""
		expected := int32(2339)
		switch key {
		case "effect-call":
			body = "try Users." + member + "(1)"
		case "held-call":
			body = "Users." + member + "(1)"
		case "plain-call":
			body = "Users.value()"
		case "member-value":
			body = "Users." + member
		case "static-name":
			body = "Users.name"
			expected = 0
		case "static-key":
			body = "Users.key"
			expected = 0
		case "explicit-effect":
			body = "try (try Users)." + member + "(1)"
			expected = 0
		case "explicit-plain":
			body = "(try Users).value()"
			expected = 0
		}
		annotation := ""
		if key == "static-name" || key == "static-key" {
			annotation = ": string!!"
		}
		source := fmt.Sprintf("interface Shape { %s(n: number): number!!; value(): number; name(): string }\nservice Users: Shape { static readonly key = %q }\nexport effect function f()%s { return %s }\n", member, "vip10/"+key+fmt.Sprint(variant), annotation, body)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		found := false
		var errors []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Source() == "" && d.Code() == expected {
				found = true
				continue
			}
			errors = append(errors, d.String())
		}
		if len(errors) != 0 || expected != 0 && !found {
			Gap(t, "FuzzServiceMemberLookup", "rule:"+key, "VIP-10: %q; want TS%d (0 means valid), got %v; matching=%v\n%s", serviceLookupQuotes[1].quote, expected, errors, found, source)
			return
		}
		ExpectPending(t, "FuzzServiceMemberLookup", "rule:"+key)
		ExpectPending(t, "FuzzServiceMemberLookup", specCorpusKey(t))
	})
}
