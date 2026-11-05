package vibelang

import (
	"strings"
	"testing"
)

// Smithers Poll.make exposed a whole descriptive @throws paragraph in its
// declaration. Chapter 1 preserves authored docs, and Chapter 7 refuses a
// repair that cannot preserve declaration output.
func TestThrowsTagFixPreservesAuthoredDocumentation(t *testing.T) {
	for _, tag := range []string{
		"@throws A RangeError when the interval is invalid.",
		"@throws {RangeError} Invalid interval.",
		"@throws {never} No failures are expected.",
		"@throws A RangeError on invalid input.\n * The budget must be positive.",
		"@throws {Error} See {@link RangeError} for the bounds.",
		"@rethrows callback Propagates the callback failure.",
	} {
		for _, shape := range []string{
			"DOC\nexport function make(callback: () => number): number { return 1 }",
			"DOC\nexport const make = (callback: () => number): number => 1",
			"export class Poll {\nDOC\nmake(callback: () => number): number { return 1 } }",
			"export interface Poll {\nDOC\nmake(callback: () => number): number }",
			"export namespace Poll {\nDOC\nexport function make(callback: () => number): number { return 1 } }",
		} {
			t.Run(tag+"/"+shape[:min(12, len(shape))], func(t *testing.T) {
				doc := "/** Creates a bounded poll.\n * " + tag + "\n * @category constructors\n */"
				source := strings.Replace(shape, "DOC", doc, 1)
				result := fixProjectOf(t, map[string]string{"main.vibe": source})
				if result.Err != nil {
					t.Fatal(result.Err)
				}
				after := fixedText(result, "main.vibe")
				if after == "" {
					after = source
				}
				if !strings.Contains(after, doc) {
					t.Fatalf("automatic fix discarded authored documentation:\nbefore:\n%s\nafter:\n%s", source, after)
				}
				found := false
				for _, refusal := range result.Sites {
					found = found || refusal.Code == "EK0406" && refusal.StartLine > 0
				}
				if !found {
					t.Fatalf("missing located EK0406 refusal: %+v", result.Sites)
				}
			})
		}
	}
}

func TestThrowsTagFixPreservesContractOnlyTags(t *testing.T) {
	for _, tag := range []string{"@throws {Error}", "@throws {never}", "@rethrows callback"} {
		t.Run(tag, func(t *testing.T) {
			source := "/** " + tag + " */\nexport function make(callback: () => number): number { return 1 }"
			result := fixProjectOf(t, map[string]string{"main.vibe": source})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			after := fixedText(result, "main.vibe")
			if after != "" && after != source {
				t.Fatalf("automatic repair changed an authored contract: %s", after)
			}
			refused := false
			for _, site := range result.Sites {
				refused = refused || site.Code == "EK0406" && site.StartLine > 0
			}
			if !refused {
				t.Fatalf("missing located contract refusal: %+v", result.Sites)
			}
		})
	}
}

// A neighboring bare tag must not cause the whole comment to be removed,
// erasing the descriptive tag that requires manual migration.
func TestThrowsTagFixKeepsDescriptiveSibling(t *testing.T) {
	for _, tags := range []string{
		"@throws {never}\n * @throws {Error} Keep the poll interval explanation.",
		"@throws {Error} Keep the poll interval explanation.\n * @throws {never}",
	} {
		source := "/**\n * " + tags + "\n */\nexport function make(): number { return 1 }"
		result := fixProjectOf(t, map[string]string{"main.vibe": source})
		after := fixedText(result, "main.vibe")
		if after == "" {
			after = source
		}
		if result.Err != nil || !strings.Contains(after, "@throws {Error} Keep the poll interval explanation.") {
			t.Fatalf("lost descriptive sibling: %+v\n%s", result, after)
		}
	}
}

// Chapter 7 refuses an unsafe rewrite at its site; an independent preserving
// prelude repair still applies while the authored documentation stays intact.
func TestThrowsTagRefusalAllowsPreludeRepair(t *testing.T) {
	for _, tag := range []string{"@throws {never}", "@throws {Error} Keep the bounds.", "@rethrows callback"} {
		for _, alias := range []struct{ before, after string }{
			{"Stream<number>", "Stream.Stream<number>"},
			{"Layer<never>", "Layer.Layer<never>"},
		} {
			t.Run(tag+"/"+alias.before, func(t *testing.T) {
				doc := "/** " + tag + " */"
				source := doc + "\nexport function make(): number { return 1 }\ntype Independent = " + alias.before + "\n"
				result := fixProjectOf(t, map[string]string{"main.vibe": source})
				if result.Err != nil {
					t.Fatal(result.Err)
				}
				got := fixedText(result, "main.vibe")
				want := strings.Replace(source, alias.before, alias.after, 1)
				if got != want {
					t.Fatalf("independent repair changed the refused documentation:\nwant:\n%s\ngot:\n%s", want, got)
				}
				refused := false
				for _, site := range result.Sites {
					refused = refused || site.Code == "EK0406" && site.StartLine > 0
				}
				if !refused {
					t.Fatalf("missing located documentation refusal: %+v", result.Sites)
				}
			})
		}
	}
}
