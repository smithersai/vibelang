package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestMapperSchemaSpansQuoted(t *testing.T) {
	chapterSays(t, "006-data.md", "A reference names a Schema value, not an expanded TypeScript type alias, interface, enum or class.")
	chapterSays(t, "007-tooling.md", "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`.")
}

// Schema references retain their binding identity when tools read the projection.
// Mutate the wrappers around each written name and require exact source spans,
// including when the generated expression is longer than the original type.
func FuzzMapperSchemaSpans(f *testing.F) {
	startShortBudget(f)
	forms := []struct{ key, typ string }{
		{"named", "$A"},
		{"qualified", "Schema.$A"},
		{"array", "$A[]"},
		{"generic-array", "Array<$A>"},
		{"union", "$A | $B"},
		{"tuple", "[$A, $B]"},
		{"nested", "{ inner: $A; readonly other?: $B[] }"},
		{"record", "Record<string, $A>"},
		{"map", "ReadonlyMap<$A, $B>"},
		{"set", "ReadonlySet<$A>"},
		{"commented", "/* before */ $A /* after */"},
	}
	keys := make([]string, len(forms))
	for i, form := range forms {
		keys[i] = form.key
		for mode := uint8(0); mode < 64; mode++ {
			f.Add(form.key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMapperSchemaSpansQuoted(t)
		index, _ := keyedChoice(keys, []byte(key))
		form := forms[index]
		typ := strings.NewReplacer("$A", "WrittenValue", "$B", "OtherValue").Replace(form.typ)
		declaration, field, projectedField := "MappedShape", "writtenField", "writtenField"
		if mode&8 != 0 {
			declaration = "\\u004dappedShape"
		}
		switch mode >> 4 & 3 {
		case 1:
			field, projectedField = "\\u005f_proto__", `["__proto__"]`
		case 2:
			field, projectedField = "__proto__", "__proto__"
		case 3:
			field, projectedField = `"__proto__"`, `"__proto__"`
		}
		source := "schema " + declaration + " { " + field + ": " + typ + " }\n"
		if mode&1 != 0 {
			source = "schema " + declaration + " = { readonly " + field + "?: " + typ + " }\n"
		}
		if mode&2 != 0 {
			source = "export " + source
		}
		if mode&4 != 0 {
			source = "// λ\r\nnamespace Container { " + strings.ReplaceAll(source, "\n", "\r\n") + " }"
		}
		for rendering, project := range map[string]func(string, vibelangmapper.FileContext) vibelangmapper.Projection{
			"checking": vibelangmapper.Project, "executable": vibelangmapper.Executable,
		} {
			result := project(source, vibelangmapper.FileContext{})
			mapping := spanmap.New(result.Segments)
			if err := mapping.Validate(result.Text, source); err != nil {
				Gap(t, "FuzzMapperSchemaSpans", form.key, "%s invalid map: %v", rendering, err)
			}
			for _, names := range [][2]string{{"MappedShape", declaration}, {projectedField, field}, {"WrittenValue", "WrittenValue"}, {"OtherValue", "OtherValue"}, {"inner", "inner"}, {"other", "other"}} {
				word, written := names[0], names[1]
				original := strings.Index(source, written)
				if original < 0 {
					continue
				}
				virtual := strings.LastIndex(result.Text, word)
				if virtual < 0 {
					Gap(t, "FuzzMapperSchemaSpans", form.key, "%s lost %q: %s", rendering, word, result.Text)
				}
				want := core.NewTextRange(original, original+len(written))
				got, fidelity := mapping.VirtualToOriginalSpanForFeature(core.NewTextRange(virtual, virtual+len(word)), spanmap.FeatureRename)
				if !fidelity.IsSingleSegment() || got != want || word == written && !fidelity.IsExact() {
					Gap(t, "FuzzMapperSchemaSpans", form.key, "%s %q: got %v (%v), want %v; %s", rendering, word, got, fidelity, want, source)
				}
				back := mapping.OriginalToVirtualSpans(want, spanmap.FeatureDefinition)
				if len(back) != 1 || !back[0].Fidelity.IsSingleSegment() || back[0].Span.Pos() != virtual {
					Gap(t, "FuzzMapperSchemaSpans", form.key, "%s %q reverse mapping: %v, want %d", rendering, word, back, virtual)
				}
			}
		}
	})
}
