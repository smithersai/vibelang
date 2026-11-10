package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

type formatModuleBodySyntaxRule struct {
	key     string
	body    string
	invalid bool
}

var formatModuleBodySyntaxRules = []formatModuleBodySyntaxRule{
	{"error-declaration", "error Bad { reason: string }", true},
	{"effect-contract", "export function clean(value: string): string!Bad { return value.trim() }", true},
	{"missing-value", "export const value = ;", true},
	{"missing-type", "const value: = 1;", true},
	{"native-binding", "const error = 1; export const value = error;", false},
	{"native-function", "export function clean(value: string): string { return value.trim() }", false},
	{"inert-string", "export const note = \"error Bad {}\";", false},
	{"inert-comment", "// error Bad {}\nexport const value = 1;", false},
}

const formatModuleBodySyntaxKey = "format-module-body-syntax:"

func formatModuleBodySyntaxQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "001-functions.md", "Its body is a TypeScript file stored in the `.vibe` file")
	chapterSays(t, "007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent.")
}

func TestFormatModuleBodySyntaxQuoted(t *testing.T) { formatModuleBodySyntaxQuoted(t) }

func formatModuleBodySyntaxSource(data string) string {
	if !strings.HasPrefix(data, formatModuleBodySyntaxKey) {
		return data
	}
	key, mutation, _ := strings.Cut(strings.TrimPrefix(data, formatModuleBodySyntaxKey), "\n")
	mode := byte(0)
	if len(mutation) > 0 {
		mode = mutation[0]
	}
	rule := formatModuleBodySyntaxRules[int(mode)%len(formatModuleBodySyntaxRules)]
	for _, candidate := range formatModuleBodySyntaxRules {
		if candidate.key == key {
			rule = candidate
			break
		}
	}
	name := []string{"text", "helpers", "café", ""}[mode%4]
	head := "module"
	if name != "" {
		head += " " + name
	}
	gap := " "
	if mode&4 != 0 {
		gap = " /* body */ "
	}
	body := rule.body
	if rule.invalid && mode&16 != 0 {
		body = "function inner() { " + body + " }"
	}
	source := head + gap + "{\n" + body + "\n}\n"
	if mode&8 != 0 {
		source = "// café 😀\n" + source
	}
	if mode&32 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source
}

func TestFormatModuleBodySyntaxOracle(t *testing.T) {
	formatModuleBodySyntaxQuoted(t)
	for _, rule := range formatModuleBodySyntaxRules {
		native := toolsSyntaxError("body.ts", rule.body) != ""
		if native != rule.invalid {
			t.Fatalf("invalid native fixture %s: syntax=%v, want %v", rule.key, native, rule.invalid)
		}
		for _, mode := range []byte{0, 1, 2, 3, 255} {
			source := formatModuleBodySyntaxSource(formatModuleBodySyntaxKey + rule.key + "\n" + string([]byte{mode}))
			got := formatSyntaxError(source)
			if (got != "") != rule.invalid {
				t.Errorf("module body %s mode=%d syntax=%q, want invalid=%v\n%s", rule.key, mode, got, rule.invalid, source)
			}
			_, err := vibelangfmt.Format("main.vibe", source, func(s string) (string, error) { return s, nil })
			if (err != nil) != rule.invalid {
				t.Errorf("formatter body %s mode=%d error=%v, want invalid=%v\n%s", rule.key, mode, err, rule.invalid, source)
			}
		}
	}
}
