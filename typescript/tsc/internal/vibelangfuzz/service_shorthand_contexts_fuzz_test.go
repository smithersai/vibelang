package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var serviceShorthandContexts = []string{"try-direct", "catch-head", "parenthesized-catch-head", "option-argument"}

const serviceShortcutQuote = "There is no `Users.find(id)` shorthand"

func TestServiceShorthandContextsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceShortcutQuote) {
		t.Fatalf("Chapter5 no longer says %q", serviceShortcutQuote)
	}
}

// VIP10 denies static member shortcuts. Check admission, rather than giving
// this retired syntax a new runtime meaning. Every rejection has the same
// get-the-service counterpart in the same catch/program context.
func FuzzServiceShorthandContexts(f *testing.F) {
	startShortBudget(f)
	for _, key := range serviceShorthandContexts {
		for _, variant := range []byte{0, 1, 2, 3, 0x54, 0xff} {
			f.Add(key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestServiceShorthandContextsQuoted(t)
		if !slices.Contains(serviceShorthandContexts, key) {
			index := 0
			if len(key) > 0 {
				index = int(key[0]) % len(serviceShorthandContexts)
			}
			key = serviceShorthandContexts[index]
		}
		// Upper bits vary member names and payloads beyond the seeded access forms.
		name := []string{"record", "write", "lookup", "café"}[variant>>4&3]
		member := "." + name
		expected := int32(2339)
		if variant&1 != 0 {
			expected = 7053
			member = "[" + fmt.Sprintf("%q", name) + "]"
		}
		payload := fmt.Sprintf("({n:%d})", variant>>2)
		tag := "Audit"
		alias := ""
		if variant&2 != 0 {
			tag = "Proxy"
			alias = "const Proxy = Audit;\n"
		}
		wrap := func(call string) string {
			switch key {
			case "try-direct":
				return "return try " + call + ";"
			case "catch-head":
				return "return " + call + " catch () => undefined;"
			case "parenthesized-catch-head":
				return "return (" + call + ") catch () => undefined;"
			case "option-argument":
				return "return try Effect.option(" + call + ");"
			}
			return ""
		}
		if wrap("x") == "" {
			return
		}
		prefix := "import * as Effect from \"effect/Effect\";\nservice Audit { " + name + "(input: {n:number}): void!! }\n" + alias
		good := prefix + "export effect function main() { const audit = try " + tag + "; " + wrap("audit"+member+payload) + " }\n"
		bad := prefix + "export effect function main() { " + wrap(tag+member+payload) + " }\n"
		compile := func(source string) []*ast.Diagnostic {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var errors []*ast.Diagnostic
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, d)
				}
			}
			return errors
		}
		if errors := compile(good); len(errors) != 0 {
			t.Fatalf("get-service control must compile: %v\n%s", errors, good)
		}
		feature := fmt.Sprintf("reject:%s:%d", key, variant&3)
		if errors := compile(bad); !serviceShorthandRejected(errors, expected) {
			Gap(t, "FuzzServiceShorthandContexts", feature, "VIP10/chapter5: %s; want exactly one native TS%d in %s, got %v:\n%s", serviceShortcutQuote, expected, key, errors, bad)
		}
		ExpectPending(t, "FuzzServiceShorthandContexts", feature)
		ExpectPending(t, "FuzzServiceShorthandContexts", specCorpusKey(t))
	})
}

// serviceShorthandRejected recognizes the static-member rejection.
func serviceShorthandRejected(errors []*ast.Diagnostic, expected int32) bool {
	return len(errors) == 1 && errors[0].Source() == "" && errors[0].Code() == expected
}
