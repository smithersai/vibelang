package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const formatServiceSeparatorKey = "format-service-separators:"

var formatServiceSeparatorRules = []struct {
	key     string
	members []string
}{
	{"method", []string{"first(): number!!", "second(): string!!"}},
	{"property", []string{"readonly label: string", "count: number"}},
	{"nested", []string{"pair: [number,string]", "object: { x: number, y: string }", "literal: \"a,b\""}},
	{"generic", []string{"map<A,B>(a: A,b: B): [A,B]", "read?(): number!!"}},
	{"comments", []string{"first(): number!! /* before comma */", "/* after comma */ second(): string!!"}},
	{"callback", []string{"callback: (a: number,b: string) => string", "list: Array<[number,string]>"}},
	{"abstract-error", []string{"detail: string /* before comma */", "/* after comma */ context: { x: number, y: string }", "pair: [number,string]"}},
}

func formatServiceSeparatorsQuoted(t testing.TB) {
	t.Helper()
	for _, q := range []struct{ chapter, quote string }{
		{"900-appendices.md", `Separator = ";" | "," | a LineTerminator`},
		{"007-tooling.md", "formatting is idempotent."},
	} {
		text, err := os.ReadFile(SpecPath(q.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), q.quote) {
			t.Fatalf("%s no longer says %q", q.chapter, q.quote)
		}
	}
}
func TestFormatServiceSeparatorsQuoted(t *testing.T) { formatServiceSeparatorsQuoted(t) }

// Keyed source expansion feeds the existing FuzzFormat preservation oracle.
// Mutation varies separator line breaks, comments and trailing commas without
// changing commas nested inside parameter lists, tuples, generics or strings.
func formatServiceSeparatorSource(source string) string {
	if !strings.HasPrefix(source, formatServiceSeparatorKey) {
		return source
	}
	data := strings.TrimPrefix(source, formatServiceSeparatorKey)
	key, mutation, _ := strings.Cut(data, "\n")
	choice := 0
	if len(data) > 0 {
		choice = int(data[0]) % len(formatServiceSeparatorRules)
	}
	for i, r := range formatServiceSeparatorRules {
		if r.key == key {
			choice = i
			break
		}
	}
	rule := formatServiceSeparatorRules[choice]
	sep := ", "
	if len(mutation) > 0 {
		sep = []string{", ", ",\n", ", /* separator */\n", ",\r\n"}[int(mutation[0])%4]
	}
	trailing := ","
	if len(mutation) > 1 && mutation[1]%2 == 1 {
		trailing = ""
	}
	if rule.key == "abstract-error" {
		return "abstract error Formatting { " + strings.Join(rule.members, sep) + trailing + " }\nexport function main() { return 1 }\n"
	}
	return "export service Formatting { static readonly key = \"format/service-separators\"; " + strings.Join(rule.members, sep) + trailing + " }\nexport function main() { return 1 }\n"
}
func TestFormatServiceSeparatorGenerator(t *testing.T) {
	for _, r := range formatServiceSeparatorRules {
		for i := range 4 {
			source := formatServiceSeparatorSource(formatServiceSeparatorKey + r.key + "\n" + string([]byte{byte(i), byte(i % 2)}))
			if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
				t.Fatalf("%s: %s\n%s", r.key, syntax, source)
			}
		}
	}
}
