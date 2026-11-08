package vibelangfuzz

import (
	"encoding/json"
	"strings"
	"testing"
)

const crossConfigTarget = "FuzzPreludeCrossConfigTypes"
const crossConfigQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."
const crossConfigMeaningQuote = "Written imports, local or ambient types, type parameters, already qualified exports and a namespace's own members keep their TypeScript meaning."

func TestPreludeCrossConfigTypesQuoted(t *testing.T) { crossConfigQuoted(t) }
func crossConfigQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("007-tooling.md")
	for _, quote := range []string{crossConfigQuote, crossConfigMeaningQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}

func crossConfigProject(key string, consumer bool) Project {
	parts := strings.Split(key, "/")
	head, typ, value := "export {}\n", "FileSystem.FileSystem", "FileSystem.FileSystem"
	switch parts[0] {
	case "namespace":
		head = "import * as FileSystem from \"effect/FileSystem\"\n"
	case "named", "named-heritage":
		head, typ, value = "import { FileSystem } from \"effect/FileSystem\"\n", "FileSystem", "FileSystem"
	case "barrel", "barrel-heritage":
		head, typ = "import { FileSystem } from \"effect\"\n", "FileSystem"
	case "option":
		head, typ, value = "export {}\n", "Option.Option<number>", "Option.some(1)"
	case "option-import":
		head, typ, value = "import type { Option } from \"effect/Option\"\nimport * as Values from \"effect/Option\"\n", "Option<number>", "Values.some(1)"
	}
	exported := ""
	if parts[1] == "public" {
		exported = "export "
	}
	body := exported + "interface Box { readonly fs: " + typ + " }\n" +
		"const Box: Context.Service<Box, Box> = Context.Service<Box, Box>(\"test/Box\")\n" +
		exported + "const layer: Layer<Box, never, " + typ + "> = Layer.effect(Box, effect { const fs = try " + value + "; return { fs } })\n"
	if strings.HasSuffix(parts[0], "-heritage") {
		head += "import * as NativeFS from \"effect/FileSystem\"\n"
		body = exported + "interface View extends FileSystem {}\n" + exported + "const exact: View = undefined as unknown as NativeFS.FileSystem\n"
	}
	if strings.HasPrefix(parts[0], "option") {
		body = exported + "const value: " + typ + " = " + value + "\n"
	}
	files := map[string]string{"main.vibe": head + body}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(DefaultConfig), &cfg); err != nil {
		panic(err)
	}
	options := cfg["compilerOptions"].(map[string]any)
	options["lib"] = []string{"ES2022"}
	options["types"] = []string{}
	options["exactOptionalPropertyTypes"] = true
	cfg["files"] = []string{"main.vibe"}
	if consumer {
		options["lib"] = []string{"ES2022", "DOM"}
		files["ambient.d.ts"] = "export {}\ndeclare global { interface Option<A> { readonly hostBrand: A } }\n"
		cfg["files"] = []string{"main.vibe", "ambient.d.ts"}
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		panic(err)
	}
	return Project{Files: files, Config: string(data)}
}
