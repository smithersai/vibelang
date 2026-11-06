package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const errorMatchCounterpartQuote = "A generated error matcher tests the tag of the subject, including a foreign plain object with that tag:"

func TestErrorMatchCounterpartQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), errorMatchCounterpartQuote) {
		t.Fatalf("generated error matcher rule moved: %q", errorMatchCounterpartQuote)
	}
}

// The written migration counterpart installs that same generated matcher.
// Shadowed helpers and mismatching tags do not establish the quoted guarantee.
func FuzzErrorMatchCounterpart(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"data", "schema"} {
		for _, variant := range []uint8{0, 1, 2, 4, 8} {
			f.Add(key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestErrorMatchCounterpartQuoted(t)
		schema := key == "schema"
		if key != "data" && key != "schema" && len(key) > 0 {
			schema = key[0]%2 != 0
		}
		variant %= 16
		// Negative bare patterns probe coverage; the positive extractor probes its single capture.
		if variant&3 != 0 {
			variant &^= 8
		}
		root := `class Base extends Data.TaggedError("Base" as string)<{ readonly id: string }> {}`
		child := `class Child extends $errorSubclass(Base, "Child") {`
		tail := `declare readonly _tag: "Child"; }`
		registration := `install(this, "Child", true)`
		if schema {
			root = `class Base extends Schema.TaggedError<Base>()("Base" as string, { id: Schema.String }) {}`
			child = `class Child extends Base.extend<Child>("Child")({ _tag: Schema.tag("Child") }) {`
			tail = `}`
			registration = `install(this, "Child")`
		}
		if variant&1 != 0 {
			registration = strings.ReplaceAll(registration, `"Child"`, `"Other"`)
		}
		if variant&2 != 0 {
			registration = strings.ReplaceAll(registration, "install(", "fake(")
		}
		imports := `import { $errorSubclass, $schemaErrorMatcher as install } from "vibelang-runtime";`
		if variant&4 != 0 {
			imports = `import * as Runtime from "vibelang-runtime"; import { $errorSubclass } from "vibelang-runtime";`
			registration = strings.ReplaceAll(registration, "install(", "Runtime.$schemaErrorMatcher(")
		}
		pattern, value := "Child", "subject.id"
		if variant&8 != 0 {
			pattern, value = "Child(let item)", "item.id"
		}
		source := `import { Data, Schema } from "effect";` + imports + `
function fake(_class: unknown, _tag: string, _privateBase?: boolean): void {}
` + root + child + "static { " + registration + " } " + tail + `
function label(subject: Child | { readonly _tag: "Child"; readonly id: string }): string {
 return match(subject) { when ` + pattern + ": " + value + `; }
}`
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		missing, other := 0, 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() == 4701 {
				missing++
			} else {
				other++
			}
		}
		want := 0
		if variant&3 != 0 {
			want = 1
		}
		if missing != want || other != 0 {
			Gap(t, "FuzzErrorMatchCounterpart", fmt.Sprintf("%s/%d", key, variant),
				"%s expected %d coverage errors only, got %v\n%s", errorMatchCounterpartQuote, want, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
	})
}
