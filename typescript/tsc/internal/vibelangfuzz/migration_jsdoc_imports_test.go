package vibelangfuzz

import (
	"crypto/sha256"
	"fmt"
	"slices"
	"strings"
	"testing"
)

const migrationJSDocTarget = "FuzzMigrationJSDocImports"
const migrationJSDocQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."

func TestMigrationJSDocImportsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("000-intro.md"), migrationJSDocQuote) {
		t.Fatalf("Chapter 0 no longer says %q", migrationJSDocQuote)
	}
}

func migrationJSDocSources(key string) (string, string) {
	parts := strings.Split(key, ":")
	name := "Envelope"
	if len(parts) > 3 {
		name = parts[3]
	}
	comment := map[string]string{
		"link":      "/** See {@link Envelope.correlationId}. */",
		"linkcode":  "/** See {@linkcode Envelope.correlationId}. */",
		"linkplain": "/** See {@linkplain Envelope.correlationId label}. */",
		"plain":     "/** See Envelope.correlationId. */",
	}[parts[0]]
	base := "export const Envelope = { id: \"\" }\nexport interface Meta { {property} readonly correlationId?: string }\nexport const entity = Entity\n"
	before := strings.ReplaceAll(base, "{property}", "")
	after := comment + "\n" + before
	switch parts[1] {
	case "property":
		after = strings.ReplaceAll(base, "{property}", comment)
	case "property-multiline":
		after = "export const Envelope = { id: \"\" }\nexport interface Meta {\n  " + comment + "\n  readonly correlationId?: string\n}\nexport const entity = Entity\n"
	case "interface":
		after = strings.Replace(before, "export interface", comment+"\nexport interface", 1)
	}
	return strings.ReplaceAll(before, "Envelope", name), strings.ReplaceAll(after, "Envelope", name)
}

// Alchemy-29: a TypeScript documentation link has no runtime meaning. Compare
// the compiler with itself on the same ESM program with and without that
// comment. Ordinary doc links must not introduce imports or duplicate bindings.
// The original property link and nearby interface/module links are all kept.
func FuzzMigrationJSDocImports(f *testing.F) {
	startShortBudget(f)
	var keys []string
	for _, kind := range []string{"link", "linkcode", "linkplain", "plain"} {
		for _, place := range []string{"property", "property-multiline", "interface", "module"} {
			for _, mode := range []string{"nodenext", "preserve"} {
				for _, name := range []string{"Envelope", "Sharding"} {
					key := kind + ":" + place + ":" + mode + ":" + name
					keys = append(keys, key)
					_, source := migrationJSDocSources(key)
					f.Add(key, source)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, source string) {
		TestMigrationJSDocImportsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		if reason := Admissible(Single(source)); reason != "" {
			return
		}
		if len(source) > 16<<10 {
			return
		}
		_, known := migrationJSDocSources(key)
		original := source
		// Only ordinary documentation comments are erased. Scanner token ranges
		// keep lookalike strings, templates and executable code byte-for-byte.
		for _, token := range slices.Backward(toolsScan(source)) {
			if toolsIsComment(token) && slices.Contains([]string{
				"/** See {@link Envelope.correlationId}. */", "/** See {@linkcode Envelope.correlationId}. */",
				"/** See {@linkplain Envelope.correlationId label}. */", "/** See Envelope.correlationId. */",
				"/** See {@link Sharding.correlationId}. */", "/** See {@linkcode Sharding.correlationId}. */",
				"/** See {@linkplain Sharding.correlationId label}. */", "/** See Sharding.correlationId. */",
			}, token.text) {
				source = source[:token.start] + source[token.end:]
			}
		}
		if source == original {
			return
		}
		before, after := source, original
		compile := func(source string) []string {
			t.Helper()
			var result *Result
			var err error
			within(t, "compile documentation-link program", func() {
				config := DefaultConfig
				if strings.Contains(key, ":preserve:") {
					config = `{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"Bundler","strict":true,"skipLibCheck":true,"types":[],"outDir":"out","declaration":true}}`
				}
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": "{\"type\":\"module\"}"}, Config: config})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if original != known {
					t.Skip("mutated program is not well typed")
				}
				t.Fatalf("documentation-link witness must compile: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			var names []string
			for name := range result.Outputs {
				if strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".mjs") || strings.HasSuffix(name, ".cjs") {
					names = append(names, name)
				}
			}
			slices.Sort(names)
			if len(names) == 0 {
				t.Fatal("documentation-link program emitted no JavaScript")
			}
			var tokens []string
			for _, name := range names {
				tokens = append(tokens, name)
				for _, token := range toolsScan(result.Outputs[name]) {
					if !toolsIsComment(token) {
						tokens = append(tokens, fmt.Sprintf("%d:%s", token.kind, token.text))
					}
				}
			}
			return tokens
		}
		expected, actual := compile(before), compile(after)
		gapKey := "emit:" + key
		if original != known {
			gapKey += fmt.Sprintf(":%x", sha256.Sum256([]byte(original)))
		}
		if !slices.Equal(expected, actual) {
			Gap(t, migrationJSDocTarget, gapKey, "Chapter 0: %q; an ordinary JSDoc link must not change JavaScript tokens or introduce runtime imports. Before %v; after %v\n%s", migrationJSDocQuote, expected, actual, after)
		}
		ExpectPending(t, migrationJSDocTarget, gapKey)
		ExpectPending(t, migrationJSDocTarget, specCorpusKey(t))
	})
}
