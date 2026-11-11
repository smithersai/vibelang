// 003-failures.md: both error forms reject extends; native parents do not bypass the tag-family prohibition
// rule: docs/design/src/003-failures.md#c6b3c2a5c8791289
package vibelangfuzz

import (
	"strings"
	"testing"
)

// A narrow parent's incompatible tag already reports EK2117 under the old
// family rules. Extensible native parents distinguish that check from the
// Chapter 3 prohibition on the extends clause itself.
func failuresErrorFamilyCases() []*failCase {
	const quote = "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |"
	var cases []*failCase
	for _, form := range []struct {
		prefix string
		vip    int
	}{{"error", 13}, {"schema error", 29}} {
		for _, tag := range []struct{ name, text string }{
			{"string", `"Base" as string`},
			{"union", `"Base" as "Base" | "Child"`},
			{"template", `"Base" as ` + "`Base${string}`" + ` | "Child"`},
			{"intersection", `"Base" as string & {}`},
		} {
			for _, body := range []struct{ name, text string }{
				{"empty", "{}"},
				{"field", "{ value: number }"},
				{"optional", "{ value?: number }"},
				{"getter", "{ get label(): string { return this.id } }"},
				{"method", "{ label(): string { return this.id } }"},
				{"readonly", "{ readonly value: number }"},
			} {
				base := "class Base extends Data.TaggedError(" + tag.text + ")<{ readonly id: string }> {}"
				if form.prefix == "schema error" {
					base = "class Base extends Schema.TaggedError<Base>()(" + tag.text + ", { id: Schema.String }) {}"
				}
				name := strings.ReplaceAll(form.prefix, " ", "-") + "-extends-native-" + tag.name + "-" + body.name
				cases = append(cases, &failCase{
					Name: name, Quote: quote, VIP: form.vip, Owner: "conf-auto-error-extends-admission", Host: "none", Code: 2117,
					Decls: "import { Data, Schema } from \"effect\"\n" + base + "\nexport " + form.prefix + " Child ⟦extends Base⟧ " + body.text + "\n",
				})
			}
		}
	}
	// Every kind of parent receives the same clause diagnostic, including
	// cross-kind parents and classes with no error tag at all.
	for _, form := range []struct {
		prefix string
		vip    int
	}{{"error", 13}, {"schema error", 29}} {
		for _, parent := range []struct{ name, text string }{
			{"data", `class Base extends Data.TaggedError("Base") {}`},
			{"schema", `class Base extends Schema.TaggedError<Base>()("Base", {}) {}`},
			{"plain", `class Base {}`},
		} {
			cases = append(cases, &failCase{
				Name:  strings.ReplaceAll(form.prefix, " ", "-") + "-extends-parent-" + parent.name,
				Quote: "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |",
				VIP:   form.vip, Host: "none", Code: 2117, OneDiagnostic: true,
				Decls: "import { Data, Schema } from \"effect\"\n" + parent.text + "\nexport " + form.prefix + " Child ⟦extends Base⟧ {}\n",
			})
		}
	}

	return cases
}

// Keep this family's oracle runnable when another chapter's quote is stale.
func TestErrorInheritanceQuoted(t *testing.T) {
	for _, c := range failuresErrorFamilyCases() {
		if !strings.Contains(SpecText(c.chapter()), c.Quote) {
			t.Fatalf("%s: %s no longer says %q", c.Name, c.chapter(), c.Quote)
		}
	}
}

func TestErrorInheritanceSpec(t *testing.T) {
	TestErrorInheritanceQuoted(t)
	w := NewWorkspace(t)
	for _, c := range failuresErrorFamilyCases() {
		t.Run(c.Name, func(t *testing.T) { checkFailures(t, w, c, 0) })
	}
}
