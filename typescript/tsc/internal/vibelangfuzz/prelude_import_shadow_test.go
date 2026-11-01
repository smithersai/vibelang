package vibelangfuzz

import (
	"fmt"
	"os/exec"
	"slices"
	"strings"
	"testing"
)

const preludeImportShadowTarget = "FuzzPreludeImportShadow"
const preludeImportShadowQuote = "A local declaration or import shadows one, as with any global."
const preludeImportShadowEmitQuote = "Emitted code imports each namespace from `effect/<Module>` and each function from `effect/Function`, under a fresh name."

func TestPreludeImportShadowQuoted(t *testing.T) {
	chapter := SpecText("005-services.md")
	for _, quote := range []string{preludeImportShadowQuote, preludeImportShadowEmitQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 5 no longer says %q; re-read binding shadowing before changing the oracle", quote)
		}
	}
}

var preludeImportShadowNames = []string{"Resource", "Option", "Schema", "Config", "Headers", "Event"}
var preludeImportShadowForms = []string{"named", "alias", "default", "namespace", "type-only", "local", "mixed"}

// opencode-43: Resource imported from sst/resource must shadow the prelude.
// These files minimize the reported two-module source without depending on
// sst. The same text is also checked as TypeScript. Each import spelling and
// local control has a valid value or type use, independently of the prelude.
func preludeImportShadowFiles(name, form, extension, file string) map[string]string {
	path := "./res." + extension
	stub := "export const App = { stage: \"dev\" };\n" +
		"export const " + name + " = { App };\n" +
		"export const Other = " + name + ";\n" +
		"export type " + name + " = { readonly id: string };\n" +
		"export default " + name + ";\n"
	var source string
	switch form {
	case "alias":
		source = fmt.Sprintf("import { Other as %s } from %q;\n", name, path)
	case "default":
		source = fmt.Sprintf("import %s from %q;\n", name, path)
	case "namespace":
		source = fmt.Sprintf("import * as %s from %q;\n", name, path)
	case "type-only":
		source = fmt.Sprintf("import type { %s } from %q;\nexport type Public = %s;\nexport const stage = \"dev\";\n", name, path, name)
	case "local":
		source = "const " + name + " = { App: { stage: \"dev\" } };\n"
	case "mixed":
		source = fmt.Sprintf("import { %s, type OtherType } from %q;\n", name, path)
		stub += "export type OtherType = number;\n"
	default:
		source = fmt.Sprintf("import { %s } from %q;\n", name, path)
	}
	if form != "type-only" {
		source += "export const stage = () => " + name + ".App.stage;\n"
	}
	if name == "Resource" && form == "named" && extension == "ts" {
		stub = "export const Resource = { App: { stage: \"dev\" } };\n"
	}
	return map[string]string{file: source, "res.ts": stub, "package.json": `{"type":"module"}`}
}

const preludeImportShadowConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"rewriteRelativeImportExtensions":true,"outDir":"out","rootDir":"."}}`

func FuzzPreludeImportShadow(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, name := range preludeImportShadowNames {
		for _, form := range preludeImportShadowForms {
			f.Add(name, form, false)
		}
	}
	// Literal migration spelling: the import names the source .ts file.
	f.Add("Resource", "named", true)
	f.Fuzz(func(t *testing.T, name, form string, sourceExtension bool) {
		TestPreludeImportShadowQuoted(t)
		if !slices.Contains(preludeImportShadowNames, name) {
			if name == "" {
				return
			}
			name = preludeImportShadowNames[int(name[0])%len(preludeImportShadowNames)]
		}
		if !slices.Contains(preludeImportShadowForms, form) {
			if form == "" {
				return
			}
			form = preludeImportShadowForms[int(form[0])%len(preludeImportShadowForms)]
		}
		extension := "js"
		if sourceExtension {
			extension = "ts"
		}
		key := name + ":" + form + ":" + extension
		for _, native := range []bool{true, false} {
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			files := preludeImportShadowFiles(name, form, extension, file)
			var result *Result
			var err error
			within(t, "compile import shadow", func() {
				result, err = w.Compile(t.Context(), Project{Files: files, Config: preludeImportShadowConfig})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if native {
					t.Fatalf("invalid native shadow control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), files[file])
				}
				Gap(t, preludeImportShadowTarget, key, "Chapter 5 imported/local binding must shadow the prelude; got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), files[file])
			}
			emitted := false
			for path, source := range result.Outputs {
				if !strings.HasSuffix(path, "/main.js") && path != "main.js" {
					continue
				}
				emitted = true
				var output []byte
				within(t, "check emitted module syntax", func() {
					cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "--check")
					cmd.Stdin = strings.NewReader(source)
					output, err = cmd.CombinedOutput()
				})
				if err != nil {
					if native {
						t.Fatalf("native shadow control emitted invalid JavaScript: %s", output)
					}
					Gap(t, preludeImportShadowTarget, key, "Chapter 5 shadowed import must emit valid JavaScript; node --check: %s\n%s", output, source)
				}
			}
			if !emitted {
				t.Fatal("shadow control produced no main.js")
			}
		}
		ExpectPending(t, preludeImportShadowTarget, key)
		ExpectPending(t, preludeImportShadowTarget, specCorpusKey(t))
	})
}
