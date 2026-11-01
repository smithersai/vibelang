package vibelangfuzz

import (
	"crypto/sha256"
	"fmt"
	"slices"
	"strings"
	"testing"
)

const migrationMemberCommentsTarget = "FuzzMigrationMemberComments"
const migrationMemberCommentsQuote = "A `service`, `error`, `schema`, `schema error` or `data` declaration is declared as TypeScript's declaration emit of its Effect TypeScript counterpart"

func TestMigrationMemberCommentsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), migrationMemberCommentsQuote) {
		t.Fatalf("Chapter 1 no longer says %q", migrationMemberCommentsQuote)
	}
}

// The original Alchemy33 service is compared with itself after erasing only
// one ordinary documentation comment. Native interface/class controls and
// first/later, written/default readonly and comment-layout variants exercise
// declaration member boundaries. In particular, newlines can turn an emitted
// readonly modifier into a phantom property; token equality would miss that.
func migrationMemberCommentSources() map[string]string {
	sources := map[string]string{}
	comments := map[string]string{
		"jsdoc":           "/** The stored values. */",
		"jsdoc-multiline": "/**\n * The stored values.\n */",
		"line":            "// The stored values.",
		"block":           "/* The stored values. */",
	}
	for _, kind := range []string{"service", "interface", "class"} {
		for commentName, comment := range comments {
			for _, placement := range []string{"first", "later"} {
				for _, modifier := range []string{"", "readonly "} {
					key := kind + ":" + commentName + ":" + placement + ":default"
					if modifier != "" {
						key = strings.TrimSuffix(key, "default") + "readonly"
					}
					head := "export " + kind + " Store {\n"
					if kind == "service" {
						head += "  static readonly key = \"test/Store\"\n"
					}
					if placement == "later" {
						head += "  marker: string"
						if kind == "class" {
							head += " = \"\""
						}
						head += "\n"
					}
					source := head + "  " + comment + "\n  " + modifier + "items: ReadonlyArray<string>"
					if kind == "class" {
						source += " = []"
					}
					sources[key] = source + "\n}\n"
				}
			}
		}
	}
	return sources
}

func FuzzMigrationMemberComments(f *testing.F) {
	startShortBudget(f)
	sources := migrationMemberCommentSources()
	keys := make([]string, 0, len(sources))
	for key := range sources {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key, sources[key])
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, source string) {
		TestMigrationMemberCommentsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		if len(source) > 12<<10 || Admissible(Single(source)) != "" {
			return
		}
		known := sources[key]
		original := source
		tokens := toolsScan(source)
		for i := len(tokens) - 1; i >= 0; i-- {
			token := tokens[i]
			if toolsIsComment(token) && slices.Contains([]string{
				"/** The stored values. */", "/**\n * The stored values.\n */",
				"// The stored values.", "/* The stored values. */",
			}, token.text) {
				source = source[:token.start] + source[token.end:]
			}
		}
		if source == original {
			return
		}
		compile := func(text string) *Result {
			t.Helper()
			var result *Result
			var err error
			within(t, "compile member comments", func() { result, err = w.Compile(t.Context(), Single(text)) })
			if err != nil {
				t.Fatal(err)
			}
			if HasError(result.Diagnostics) {
				errors := SortedKeys(Keys(result.Dir, result.Diagnostics))
				result.Remove()
				if original != known {
					t.Skip("mutated member program is not well typed")
				}
				t.Fatalf("member comment witness must compile: %v\n%s", errors, text)
			}
			return result
		}
		before := compile(source)
		defer before.Remove()
		after := compile(original)
		defer after.Remove()
		if original != known {
			key += fmt.Sprintf(":mutation:%x", sha256.Sum256([]byte(original)))
		}
		names := []string{}
		for name := range before.Outputs {
			if strings.HasSuffix(name, ".d.ts") {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		if len(names) == 0 {
			t.Fatal("member program emitted no declarations")
		}
		for _, name := range names {
			expected, err := toolsFormatTree(name, before.Outputs[name])
			if err != nil {
				t.Fatalf("comment-free declaration is invalid: %v", err)
			}
			text, ok := after.Outputs[name]
			if !ok {
				t.Fatalf("comment removed declaration output %s", name)
			}
			actual, err := toolsFormatTree(name, text)
			if err != nil {
				Gap(t, migrationMemberCommentsTarget, "parse:"+key, "Chapter1: %q; ordinary member comment made emitted declaration invalid: %v\n%s", migrationMemberCommentsQuote, err, text)
			}
			var consumerErrors []DiagnosticKey
			if original == known && strings.HasPrefix(key, "service:jsdoc:") {
				// The literal migration regression stock-checks an ordinary
				// TypeScript consumer of emitted declarations. Restrict this
				// payload assumption to generated seeds, never arbitrary edits.
				marker := ""
				if strings.Contains(key, ":later:") {
					marker = "marker: \"\", "
				}
				consumer := "import type {Context} from \"effect\";\nimport {Store} from \"./service.js\";\ntype Shape = typeof Store extends Context.Key<any,infer A> ? A : never;\nconst value: Shape = {" + marker + "items: [\"value\"]};\nvoid value;\n"
				for _, commented := range []bool{false, true} {
					declaration := before.Outputs[name]
					if commented {
						declaration = text
					}
					var result *Result
					within(t, "stock-check service declaration consumer", func() {
						result, err = w.Compile(t.Context(), Project{Files: map[string]string{
							"service.d.ts": declaration, "consumer.ts": consumer,
						}})
					})
					if err != nil {
						t.Fatal(err)
					}
					errors := SortedKeys(Keys(result.Dir, result.Diagnostics))
					failed := HasError(result.Diagnostics)
					result.Remove()
					if !commented && failed {
						t.Fatalf("comment-free service consumer must compile: %v\n%s", errors, declaration)
					}
					if commented && failed {
						consumerErrors = errors
					}
				}
			}
			if expected != actual || len(consumerErrors) > 0 {
				Gap(t, migrationMemberCommentsTarget, "declaration:"+key, "Chapter1: %q; ordinary member comment changed parsed public declaration (including readonly property boundaries); stock consumer diagnostics=%v\nwithout comment:\n%s\nwith comment:\n%s\nsource:\n%s", migrationMemberCommentsQuote, consumerErrors, before.Outputs[name], text, original)
			}
		}
		ExpectPending(t, migrationMemberCommentsTarget, "declaration:"+key)
		ExpectPending(t, migrationMemberCommentsTarget, "parse:"+key)
		ExpectPending(t, migrationMemberCommentsTarget, specCorpusKey(t))
	})
}
