package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const schemaContextualHoistQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestSchemaErrorContextualHoistQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), schemaContextualHoistQuote) {
		t.Fatalf("chapter 007 lost %q", schemaContextualHoistQuote)
	}
}

// Unknown must remain accepted by the schema isomorphic input, including after repair.
func FuzzSchemaErrorContextualHoist(f *testing.F) {
	startShortBudget(f)
	keys := []string{"date", "regexp", "named-class", "typed-control", "alias"}
	for _, key := range keys {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, comment bool) {
		valid := false
		for _, candidate := range keys {
			valid = valid || key == candidate
		}
		if !valid {
			key = keys[len(key)%len(keys)]
		}
		schema, constructor, prefix := "Schema", "Date", ""
		switch key {
		case "regexp":
			constructor = "RegExp"
		case "named-class":
			constructor, prefix = "PlatformError", "class PlatformError extends Error { readonly kind = 'transport' }\n"
		case "alias":
			schema = "S"
		}
		typeArguments := ""
		if key == "typed-control" {
			typeArguments = "<typeof Date, unknown>"
		}
		if comment {
			prefix = "// café preserves the contextual field\n" + prefix
		}
		imports := "import * as Schema from 'effect/Schema'\n"
		if schema != "Schema" {
			imports += "import * as " + schema + " from 'effect/Schema'\n"
		}
		// Keep the written base namespace: declaration-emitting repairs
		// deliberately refuse a base whose public spelling would change.
		source := fmt.Sprintf("%s%sexport class Failed extends Schema.TaggedError<Failed>()('Failed', { cause: %s.instanceOf%s(%s) }) {}\nexport const acceptsUnknown: unknown extends typeof Failed.Iso['cause'] ? true : false = true\n", imports, prefix, schema, typeArguments, constructor)
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzSchemaErrorContextualHoist", files)
		defer r.Remove()
		if !toolsErrorFree(r) {
			t.Fatalf("invalid contextual schema fixture: %v", r.Diagnostics)
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir), vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		got := source
		for name, fixed := range result.Files {
			if strings.HasSuffix(string(name), "/main.vibe") {
				got = fixed.Text
			}
		}
		if !strings.Contains(got, "schema error Failed") {
			Gap(t, "FuzzSchemaErrorContextualHoist", "contextual-hoist:"+key, "%s; contextual codec was not preserved by the repair: %+v; sites: %+v\n%s", schemaContextualHoistQuote, result.Refused, result.Sites, got)
		}
		after := toolsCompile(t, w, "FuzzSchemaErrorContextualHoist", map[string]string{"main.vibe": got})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzSchemaErrorContextualHoist", "contextual-hoist:"+key, "%s; schema isomorphic input narrowed after repair: %v\n%s", schemaContextualHoistQuote, after.Diagnostics, got)
		}
	})
}
