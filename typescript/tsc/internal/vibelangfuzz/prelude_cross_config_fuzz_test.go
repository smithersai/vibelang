package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const crossConfigTarget = "FuzzPreludeCrossConfigTypes"
const crossConfigQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."
const crossConfigFixedPointQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."
const crossConfigMeaningQuote = "Written imports, local or ambient types, type parameters, already qualified exports and a namespace's own members keep their TypeScript meaning."

func TestPreludeCrossConfigTypesQuoted(t *testing.T) { crossConfigQuoted(t) }
func crossConfigQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("007-tooling.md")
	for _, quote := range []string{crossConfigQuote, crossConfigMeaningQuote, crossConfigFixedPointQuote} {
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

// VIP-14 preserves each ambient type meaning; VIP-34 requires the fixer to
// preserve types. Checking the same shared source under two configs is the
// oracle, not an assertion about the fixer's preferred spelling.
func FuzzPreludeCrossConfigTypes(f *testing.F) {
	startShortBudget(f)
	crossConfigQuoted(f)
	var keys []string
	for _, form := range []string{"prelude", "namespace", "named", "barrel", "option", "option-import", "named-heritage", "barrel-heritage"} {
		for _, visibility := range []string{"private", "public"} {
			key := form + "/" + visibility
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		fields := strings.SplitN(strings.TrimPrefix(string(data), "key:"), "\x00", 2)
		key := fields[0]
		if !slices.Contains(keys, key) {
			index := 0
			if len(data) > 0 {
				index = int(data[0]) % len(keys)
			}
			key = keys[index]
		}
		server, consumer := crossConfigProject(key, false), crossConfigProject(key, true)
		if len(fields) > 1 && len(fields[1]) > 0 {
			source := server.Files["main.vibe"]
			if fields[1][0]&1 != 0 {
				source = "// shared by server and browser\n" + source
			}
			if fields[1][0]&2 != 0 {
				source = strings.ReplaceAll(source, "\"", "'")
			}
			server.Files["main.vibe"], consumer.Files["main.vibe"] = source, source
		}
		compile := func(project Project) *Result {
			r, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			return r
		}
		before := compile(server)
		control := compile(consumer)
		if !toolsErrorFree(before) || !toolsErrorFree(control) {
			t.Fatalf("invalid cross-config witness %s: server %v consumer %v\n%s", key, before.Diagnostics, control.Diagnostics, Archive(server.Files))
		}
		fixed := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir))
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		g := &Gaps{Target: crossConfigTarget, Input: Archive(server.Files)}
		server.Files = maps.Clone(server.Files)
		consumer.Files = maps.Clone(consumer.Files)
		for name, file := range fixed.Files {
			rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			server.Files[rel], consumer.Files[rel] = file.Text, file.Text
		}
		after, other := compile(server), compile(consumer)
		if !toolsErrorFree(after) || !toolsErrorFree(other) {
			g.Add(key+"/consumer-meaning", "VIP-14/VIP-34: %s %s server %v consumer %v; fixed:\n%s", crossConfigQuote, crossConfigMeaningQuote, after.Diagnostics, other.Diagnostics, Archive(server.Files))
		} else {
			again := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir))
			if again.Err != nil {
				t.Fatal(again.Err)
			}
			if len(again.Files) != 0 {
				g.Add(key+"/fixed-point", "VIP-34: %s A second fix changed %d files", crossConfigFixedPointQuote, len(again.Files))
			}
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
