package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

const explicitSidecarQuote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."

func TestExplicitVibeSidecarResolutionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), explicitSidecarQuote) {
		t.Fatalf("Chapter 7 no longer says %q", explicitSidecarQuote)
	}
}

// Opencode's minimized legacy declaration self-exports its namespace with
// ./tool.vibe. This exercises explicit compatibility-declaration resolution,
// not the current publication policy, which uses ordinary .d.ts files. No
// source is present: consumers must retain the callback's declared types.
type explicitSidecarCase struct {
	extension, suffix, kind, layout string
	skip                            bool
}

func parseExplicitSidecar(data []byte) explicitSidecarCase {
	keys := [][]string{{"vibe", "vibex", "js"}, {"none", "migration", "platform"}, {"string", "number", "boolean"}, {"flat", "nested"}, {"checked", "skip"}}
	words := strings.Split(string(data), ":")
	values := make([]string, len(keys))
	for i, options := range keys {
		index := 0
		if i < len(data) {
			index = int(data[i]) % len(options)
		}
		values[i] = options[index]
		if i < len(words) && slices.Contains(options, words[i]) {
			values[i] = words[i]
		}
	}
	return explicitSidecarCase{values[0], values[1], values[2], values[3], values[4] == "skip"}
}

func (c explicitSidecarCase) key() string {
	skip := "checked"
	if c.skip {
		skip = "skip"
	}
	return strings.Join([]string{c.extension, c.suffix, c.kind, c.layout, skip}, ":")
}

func (c explicitSidecarCase) files(bad bool) map[string]any {
	stem := "tool"
	if c.layout == "nested" {
		stem = "deep/tool"
	}
	extension := "." + c.extension
	declaration := ".d" + extension + ".ts"
	if c.extension == "js" {
		declaration = ".d.ts"
	}
	suffix := ""
	suffixes := []string{""}
	switch c.suffix {
	case "migration":
		suffixes = []string{".vibe", ""}
	case "platform":
		suffix = ".native"
		suffixes = []string{".native", ""}
	}
	file := stem + strings.TrimSuffix(declaration, ".ts") + suffix + ".ts"
	if c.extension == "js" {
		file = stem + suffix + ".d.ts"
	}
	body := "name.length + index"
	if c.kind == "number" {
		body = "name + index"
	}
	if c.kind == "boolean" {
		body = "(name ? 1 : 0) + index"
	}
	if bad {
		body = "name.__opencodeMissingProperty"
	}
	options := map[string]any{
		"strict": true, "noImplicitAny": false, "noEmit": true, "types": []string{},
		"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
		"allowArbitraryExtensions": true, "skipLibCheck": c.skip, "moduleSuffixes": suffixes,
	}
	config, _ := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{"user.ts"}})
	// Exports name the physical declaration; moduleSuffixes applies to its
	// self-import without relying on a package target that does not exist.
	manifest, _ := json.Marshal(map[string]any{"name": "opencode-tool", "type": "module",
		"exports": map[string]any{"./tool": map[string]string{"types": "./decl/" + file, "default": "./" + stem + ".js"}}})
	dir := "/app/node_modules/opencode-tool/decl/"
	files := map[string]any{
		"/app/package.json":  "{\"type\":\"module\"}",
		"/app/tsconfig.json": string(config),
		"/app/user.ts":       "import { CodeModeTool } from \"opencode-tool/tool\";\nexport const result = CodeModeTool.create((name, index) => " + body + ");\n",
		"/app/node_modules/opencode-tool/package.json": string(manifest),
		dir + file: fmt.Sprintf("export * as CodeModeTool from \"./tool%s\";\nexport declare const create: (execute: (name: %s, index: number) => number) => number;\n", extension, c.kind),
	}
	// A native homonym and older ordinary declaration cannot steal a written
	// .vibe import from its compatibility declaration.
	if c.extension != "js" {
		files[dir+stem+suffix+".ts"] = "export declare const wrong: unique symbol;\n"
		files[dir+stem+suffix+".d.ts"] = "export declare const wrong: unique symbol;\n"
	}
	return files
}

func checkExplicitSidecar(t *testing.T, c explicitSidecarCase) {
	t.Helper()
	const target = "FuzzExplicitVibeSidecarResolution"
	defer recoverCompilerPanic(t, target)
	for _, bad := range []bool{false, true} {
		program := portableProgram(t, c.files(bad))
		// Consumer diagnostics force the namespace edge without checking every
		// standard-library declaration again on each fuzz iteration.
		found := program.GetSemanticDiagnostics(t.Context(), program.GetSourceFile("/app/user.ts"))
		messages := []string{}
		missingProperty := false
		for _, d := range found {
			messages = append(messages, d.String())
			missingProperty = missingProperty || d.Code() == 2339 && strings.Contains(d.String(), "__opencodeMissingProperty")
		}
		if !bad && len(found) != 0 {
			Gap(t, target, "valid:"+c.key(), "Chapter 7: %s; declared callback lost its context: %v", explicitSidecarQuote, messages)
		}
		if bad && !missingProperty {
			Gap(t, target, "invalid:"+c.key(), "Chapter 7: %s; missing primitive property must report TS2339 at the misuse, got %v", explicitSidecarQuote, messages)
		}
	}
}

func TestExplicitVibeSidecarResolutionRegression(t *testing.T) {
	TestExplicitVibeSidecarResolutionQuoted(t)
	for _, key := range []string{"vibe:none:string:flat:checked", "vibe:migration:number:nested:skip", "vibe:platform:boolean:nested:checked", "vibex:none:string:flat:skip", "js:platform:number:nested:checked"} {
		t.Run(key, func(t *testing.T) { checkExplicitSidecar(t, parseExplicitSidecar([]byte(key))) })
	}
}

func FuzzExplicitVibeSidecarResolution(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"vibe:none:string:flat:checked", "vibe:migration:number:nested:skip", "vibe:platform:boolean:nested:checked", "vibex:none:string:flat:skip", "js:platform:number:nested:checked"} {
		f.Add([]byte(key))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestExplicitVibeSidecarResolutionQuoted(t)
		checkExplicitSidecar(t, parseExplicitSidecar(data))
	})
}
