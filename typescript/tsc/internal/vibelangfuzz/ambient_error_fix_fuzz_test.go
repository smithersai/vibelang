package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const ambientErrorFixQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."
const ambientErrorRuleQuote = "a recognized `error` or `schema error` declaration in an ambient source context, explicit or inherited"
const ambientErrorNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func TestAmbientErrorFixQuoted(t *testing.T) { ambientErrorFixCheckQuotes(t) }

func ambientErrorFixCheckQuotes(t testing.TB) {
	t.Helper()
	for chapter, quotes := range map[string][]string{
		"003-failures.md": {ambientErrorRuleQuote},
		"007-tooling.md":  {ambientErrorFixQuote, ambientErrorNativeQuote},
	} {
		for _, quote := range quotes {
			if !strings.Contains(SpecText(chapter), quote) {
				t.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

type ambientErrorFixRule struct{ key, source, native string }

func ambientErrorFixRules() []ambientErrorFixRule {
	var rules []ambientErrorFixRule
	for _, form := range []struct{ key, head, base string }{
		{"error", "error", "Data.TaggedError(\"Missing\")"},
		{"schema-error", "schema error", "Schema.TaggedError<Missing>()(\"Missing\", %s)"},
	} {
		for _, body := range []struct{ key, fields, data, schema string }{
			{"bodyless", "", "", "{}"},
			{"empty", " {}", "", "{}"},
			{"payload", " { id: string; count?: number }", "<{ readonly id: string; readonly count?: number }>", "{ id: Schema.String, count: Schema.optional(Schema.Number) }"},
		} {
			for _, context := range []struct{ key, format string }{
				{"declare", "declare %s\nexport {}\n"},
				{"export-declare", "export declare %s\n"},
				{"namespace", "declare namespace API { export %s }\nexport {}\n"},
				{"nested-namespace", "declare namespace API { namespace Nested { export %s } }\nexport {}\n"},
				{"global", "declare global { %s }\nexport {}\n"},
			} {
				base := form.base
				if form.key == "schema-error" {
					base = fmt.Sprintf(base, body.schema)
				} else {
					base += body.data
				}
				rules = append(rules, ambientErrorFixRule{
					key:    form.key + "/" + body.key + "/" + context.key,
					source: fmt.Sprintf(context.format, form.head+" Missing"+body.fields),
					native: fmt.Sprintf(context.format, "class Missing extends "+base+" {}"),
				})
			}
		}
	}
	return rules
}

func ambientErrorFixPick(data []byte, rules []ambientErrorFixRule) int {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		for i, rule := range rules {
			if rule.key == key {
				return i
			}
		}
	}
	if len(data) == 0 {
		return 0
	}
	return int(data[0]) % len(rules)
}

func TestAmbientErrorFixStable(t *testing.T) {
	rules := ambientErrorFixRules()
	if len(rules) != 30 {
		t.Fatalf("got %d shapes, want 30", len(rules))
	}
	seen := map[string]bool{}
	reversed := slices.Clone(rules)
	slices.Reverse(reversed)
	for i, rule := range rules {
		if seen[rule.key] {
			t.Fatal("duplicate", rule.key)
		}
		seen[rule.key] = true
		if ambientErrorFixPick([]byte("key:"+rule.key), rules) != i {
			t.Fatal(rule.key)
		}
		if reversed[ambientErrorFixPick([]byte("key:"+rule.key), reversed)].key != rule.key {
			t.Fatal("reordered", rule.key)
		}
	}
}

// Namespace imports may be supplied by the implicit prelude even when the
// written class is ambient. No class, initializer or executable statement may
// survive erasure. An empty export only marks this file as a module.
func ambientErrorFixErased(js string) bool {
	file := toolsParse("main.js", js)
	if len(file.Diagnostics()) != 0 {
		return false
	}
	for _, statement := range file.Statements.Nodes {
		switch statement.Kind {
		case ast.KindImportDeclaration, ast.KindEmptyStatement:
		case ast.KindExportDeclaration:
			export := statement.AsExportDeclaration()
			if export.ModuleSpecifier != nil || export.ExportClause == nil ||
				export.ExportClause.Kind != ast.KindNamedExports ||
				len(export.ExportClause.AsNamedExports().Elements.Nodes) != 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func TestAmbientErrorFixErasure(t *testing.T) {
	for _, js := range []string{"", "export {};", "import * as Data from 'effect/Data'; export {};"} {
		if !ambientErrorFixErased(js) {
			t.Fatalf("ambient module rejected: %s", js)
		}
	}
	for _, js := range []string{"class Missing {}", "const Missing = class {};", "void 0;", "(() => {})();", "export { Missing };", "export * from 'other';", "class {"} {
		if ambientErrorFixErased(js) {
			t.Fatalf("executable or invalid module accepted: %s", js)
		}
	}
}
