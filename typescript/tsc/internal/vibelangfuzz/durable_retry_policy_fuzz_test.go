package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const retryPolicyQuote = "A written `retryPolicy` object literal with neither `maxAttempts` nor `expirationMs` is the warning `EK5509`: such a policy never gives up."
const retryPolicyDynamicQuote = "A spread or computed property name may supply a bound, so either suppresses this warning."

func retryPolicyRulesQuoted(tb testing.TB) {
	tb.Helper()
	chapter := SpecText("005-services.md")
	for _, quote := range []string{retryPolicyQuote, retryPolicyDynamicQuote} {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("retry policy rule changed: %q", quote)
		}
	}
}

func TestRetryPolicyRulesQuoted(t *testing.T) { retryPolicyRulesQuoted(t) }

type retryPolicyField struct {
	key, source string
	bounding    bool
}

var retryPolicyFields = []retryPolicyField{
	{"empty", "", false},
	{"unbounded", "jitterRatio: %d", false},
	{"numeric", "0: %d", false},
	{"quoted-other", "\"other\": %d", false},
	{"attempts", "maxAttempts: %d", true},
	{"expiration", "expirationMs: %d", true},
	{"quoted-attempts", "\"maxAttempts\": %d", true},
	{"quoted-expiration", "'expirationMs': %d", true},
	{"shorthand", "maxAttempts", true},
	{"getter", "get maxAttempts() { return %d }", true},
	{"computed-literal", "[\"maxAttempts\"]: %d", true},
	{"computed-other", "[\"other\"]: %d", true},
	{"computed-dynamic", "[key]: %d", true},
	{"computed-parenthesized", "[(key)]: %d", true},
	{"computed-template", "[`expirationMs`]: %d", true},
	{"computed-getter", "get [key]() { return %d }", true},
	{"spread-bound", "...{ maxAttempts: %d }", true},
	{"spread-other", "...{ other: %d }", true},
}

func retryPolicyFieldByKey(key string) retryPolicyField {
	for _, field := range retryPolicyFields {
		if key == field.key {
			return field
		}
	}
	if key == "" {
		return retryPolicyFields[0]
	}
	return retryPolicyFields[int(key[0])%len(retryPolicyFields)]
}

// Vary the field's spelling, declaration kind, option spelling, position,
// parentheses and an explicit bound independently. The oracle is EK5509's
// rule in the services chapter, including its conservative dynamic case.
func FuzzRetryPolicyRules(f *testing.F) {
	startShortBudget(f)
	retryPolicyRulesQuoted(f)
	for _, field := range retryPolicyFields {
		f.Add(field.key, uint8(0), uint8(2))
		f.Add(field.key, uint8(31), uint8(3))
		f.Add(field.key, uint8(33), uint8(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags, value uint8) {
		field := retryPolicyFieldByKey(key)
		fields := []string{"initialMs: 10", "factor: 2", "maxMs: 40"}
		if field.source != "" {
			source := field.source
			if strings.Contains(source, "%d") {
				source = fmt.Sprintf(source, int(value)+1)
			}
			if flags&8 == 0 {
				fields = append([]string{source}, fields...)
			} else {
				fields = append(fields, source)
			}
		}
		bounded := field.bounding
		if flags&16 != 0 && !bounded {
			fields = append(fields, "expirationMs: 100")
			bounded = true
		}
		policy := "{ " + strings.Join(fields, ", ") + " }"
		if flags&4 != 0 {
			policy = "(" + policy + ")"
		}
		word, option := "task", "retryPolicy"
		if flags&1 != 0 {
			word = "workflow"
		}
		if flags&2 != 0 {
			option = "\"retryPolicy\""
		}
		body := "return id.length"
		if flags&32 != 0 {
			body = "const methods = { [key]() { return id.length } }; return methods.other()"
		}
		source := fmt.Sprintf("const key = \"other\"\nconst maxAttempts = 2\n%s Fetch {\n static readonly %s = %s\n effect call(id: string): number!string { %s }\n}\nexport {}\n", word, option, policy, body)
		files := map[string]string{"main.vibe": source}
		result, err := w.Compile(t.Context(), builtinsProject(files))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		warnings := 0
		var other []string
		for _, d := range result.Diagnostics {
			if diagnosticKey(d) == "EK5509" {
				warnings++
			} else if d.Category() == diagnostics.CategoryError {
				other = append(other, specDiagnosticText(d))
			}
		}
		precise := fmt.Sprintf("policy:%s:%d", field.key, flags&63)
		want := 1
		if bounded {
			want = 0
		}
		if warnings != want || len(other) != 0 {
			Gap(t, "FuzzRetryPolicyRules", precise, "want %d EK5509 warnings and no errors; got %d and %v\n%s", want, warnings, other, Archive(files))
		}
	})
}
