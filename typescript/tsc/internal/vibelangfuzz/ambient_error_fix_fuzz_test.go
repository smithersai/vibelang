package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const ambientErrorFixTarget = "FuzzAmbientErrorFix"
const ambientErrorFixQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site (VIP-34)."
const ambientErrorRuleQuote = "a recognized `error` or `schema error` declaration in an ambient source context, explicit or inherited"
const ambientErrorNativeQuote = "TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types."

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

// A repair may refuse this invalid custom declaration. Every offered repair
// must retain an ambient native class that type-checks, with no runtime class
// initializer. Check each plan separately, across explicit/inherited declare,
// empty/optional payloads and both TaggedError libraries. No runtime oracle is
// needed: declaration contexts never execute. The Opencode m24 regression was
// a schema-error matcher static block inserted into an explicit declare class.
func FuzzAmbientErrorFix(f *testing.F) {
	startShortBudget(f)
	ambientErrorFixCheckQuotes(f)
	rules := ambientErrorFixRules()
	for _, rule := range rules {
		f.Add([]byte("key:" + rule.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		rule := rules[ambientErrorFixPick(data, rules)]
		defer recoverCompilerPanic(t, ambientErrorFixTarget)
		compile := func(source string) *Result {
			r := toolsCompile(t, w, ambientErrorFixTarget, map[string]string{"main.vibe": source})
			t.Cleanup(r.Remove)
			return r
		}
		native := compile(rule.native)
		if errors := r4Errors(native.Diagnostics); len(errors) != 0 {
			t.Fatalf("%s: independently written ambient native control: %v\n%s", rule.key, errors, rule.native)
		}
		if js, exists := native.Outputs["out/main.js"]; !exists || !ambientErrorFixErased(js) {
			t.Fatalf("%s: native ambient control did not erase its class: %s", rule.key, js)
		}
		g := &Gaps{Target: ambientErrorFixTarget, Input: rule.source}
		original := compile(rule.source)
		if errors := r4Errors(original.Diagnostics); !slices.Equal(errors, []string{"EK1307"}) {
			slices.Sort(errors)
			g.Add("original-diagnostic:"+rule.key+":"+strings.Join(errors, ","), "Chapter 3: %s; want EK1307 alone, got %v\n%s", ambientErrorRuleQuote, errors, rule.source)
		}
		plans, _, seen := quickfixEditorPlans(t, w, original, map[string]string{"main.vibe": rule.source}, []int32{1307})
		if !seen[1307] {
			t.Fatalf("%s: editor lost EK1307", rule.key)
		}
		for _, plan := range plans {
			if len(plan.edits) != 1 || len(plan.edits["main.vibe"]) == 0 {
				t.Fatalf("%s: unexpected edit scope %v", rule.key, plan.edits)
			}
			fixed, _, err := toolsApply(rule.source, plan.edits["main.vibe"])
			if err != nil {
				t.Fatal(err)
			}
			after := compile(fixed)
			// Ambient declarations erase their class. Import plans may differ,
			// so inspect executable declarations rather than comparing text.
			if len(r4Errors(after.Diagnostics)) == 0 {
				js, exists := after.Outputs["out/main.js"]
				if !exists || !ambientErrorFixErased(js) {
					t.Fatalf("%s: repair emitted executable declarations\n%s\nrepair:\n%s", rule.key, js, fixed)
				}
			}
			errors := r4Errors(after.Diagnostics)
			if len(errors) != 0 {
				// Include the entire diagnostic set in the pending key, so an
				// additional independent error cannot hide under a known gap.
				slices.Sort(errors)
				g.Add("offered-repair:"+rule.key+":"+strings.Join(errors, ","), "VIP-34: %s Native control compiles; repair introduces %v\nsource:\n%s\nrepair:\n%s", ambientErrorFixQuote, errors, rule.source, fixed)
			}
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
