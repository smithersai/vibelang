package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestFileSchemaBoundaryQuoted(t *testing.T) {
	for _, quote := range []string{
		"A wrapper changes how a failure is represented, not whether the platform may be called.",
		"A local binding, an import or an Effect module in scope",
	} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("Chapter 5 no longer says %q", quote)
		}
	}
}

func TestHelperReexportDeclarationsQuoted(t *testing.T) {
	const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("Chapter 1 no longer says %q", quote)
	}
}

// Keep the standard instanceOf codec and the constructor selected by the
// written binding. A raw host read is rejected; the explicit TypeScript
// boundary, local classes and host types remain legal.
func FuzzFileSchemaBoundary(f *testing.F) {
	startShortBudget(f)
	keys := []string{"identifier", "qualified", "computed", "local", "edge", "type-only"}
	for _, key := range keys {
		for home := uint8(0); home < 2; home++ {
			f.Add(key, home)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestFileSchemaBoundaryQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		prefix := "import * as Schema from \"effect/Schema\";\n"
		value, typ := "globalThis.File", "globalThis.File"
		forbidden := key == "identifier" || key == "qualified" || key == "computed"
		switch key {
		case "identifier":
			value = "File"
		case "computed":
			value = "globalThis[\"File\"]"
		case "local":
			prefix += "class File { readonly tag=\"local\"; }\n"
			value, typ = "File", "File"
		case "edge":
			prefix += "import { FileConstructor } from \"./file.platform.ts\";\n"
			value = "FileConstructor"
		}
		body := "export const Bound: Schema.Schema<" + typ + "> = Schema.instanceOf(" + value + ");\n"
		if variant%2 == 1 {
			body = "export function build(): Schema.Schema<" + typ + "> {return Schema.instanceOf(" + value + ");}\n"
		}
		if key == "type-only" {
			body = "export type HostFile = globalThis.File;\n"
		}
		if variant/2%2 == 1 {
			body = "/* constructor binding */\n" + body
		}
		source := prefix + body
		config := "{\"compilerOptions\":{\"strict\":true,\"module\":\"ESNext\",\"moduleResolution\":\"Bundler\",\"target\":\"ES2022\",\"skipLibCheck\":true,\"allowImportingTsExtensions\":true,\"noEmit\":true,\"types\":[],\"lib\":[\"ES2022\",\"DOM\"]}}"
		compile := func(name string) *Result {
			var result *Result
			var err error
			within(t, "compile File schema binding", func() {
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{
					name: source, "file.platform.ts": "export const FileConstructor = globalThis.File;\n", "package.json": "{\"type\":\"module\"}",
				}, Config: config})
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			return result
		}
		native := compile("main.ts")
		if HasError(native.Diagnostics) {
			t.Fatalf("invalid native schema control %s: %v", key, SortedKeys(Keys(native.Dir, native.Diagnostics)))
		}
		result := compile("main.vibe")
		boundary := false
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 4402 {
				boundary = true
			}
		}
		gaps := &Gaps{Target: "FuzzFileSchemaBoundary", Input: source}
		name := key + ":" + string(rune('0'+variant%2)) + ":" + string(rune('0'+variant/2%2))
		if boundary != forbidden || !forbidden && HasError(result.Diagnostics) {
			gaps.Add(name, "VIP-33/File schema: forbidden raw constructor=%t; keep local/type/TS-edge controls and standard Schema.instanceOf; got %v", forbidden, SortedKeys(Keys(result.Dir, result.Diagnostics)))
		} else {
			ExpectPending(t, "FuzzFileSchemaBoundary", name)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
