package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestPureRequestPipeReceiverQuoted(t *testing.T) {
	const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatal("preserving repair rule moved")
	}
}

func FuzzPureRequestPipeReceiver(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"namespace", "named", "alias", "unicode", "reexport"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestPureRequestPipeReceiverQuoted(t)
		prefix := "import * as Request from 'effect/http/HttpClientRequest'\n"
		get, params, header := "Request.get", "Request.setUrlParams", "Request.setHeader"
		files := map[string]string{}
		switch key {
		case "named", "alias", "reexport":
			module := "effect/http/HttpClientRequest"
			if key == "reexport" {
				module = "./request.js"
				files["request.vibe"] = "export { get as request, setUrlParams as params, setHeader as header } from 'effect/http/HttpClientRequest'\n"
			}
			if key == "named" {
				prefix = "import { get, setUrlParams, setHeader } from '" + module + "'\n"
				get, params, header = "get", "setUrlParams", "setHeader"
			} else {
				prefix = "import { " + map[bool]string{true: "request", false: "get"}[key == "reexport"] + " as make, " + map[bool]string{true: "params", false: "setUrlParams"}[key == "reexport"] + " as query, " + map[bool]string{true: "header", false: "setHeader"}[key == "reexport"] + " as field } from '" + module + "'\n"
				get, params, header = "make", "query", "field"
			}
		case "unicode":
			prefix = "import * as 要求 from 'effect/http/HttpClientRequest'\n"
			get, params, header = "要求.get", "要求.setUrlParams", "要求.setHeader"
		}
		stages := []string{params + "({ name, value })", header + "('Accept', 'application/dns-json')"}
		if mode&1 != 0 {
			stages[0], stages[1] = stages[1], stages[0]
		}
		files["main.vibe"] = prefix + "export const makeRequest = (name: string,value: string) => " + get + "('https://example.test').pipe(" + strings.Join(stages, ", ") + ")\n"
		if mode&1 != 0 {
			for name, text := range files {
				files[name] = strings.ReplaceAll(text, "\n", "\r\n")
			}
		}
		before := toolsCompile(t, w, "FuzzPureRequestPipeReceiver", files)
		defer before.Remove()
		if !toolsErrorFree(before) {
			t.Fatalf("original errors: %v", before.Diagnostics)
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil || len(result.Refused) != 0 {
			t.Fatalf("canonical receiver was refused: err=%v refusals=%v", result.Err, result.Refused)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if strings.Contains(fixed["main.vibe"], ".pipe(") || !strings.Contains(fixed["main.vibe"], "|>") || !strings.Contains(fixed["main.vibe"], "%") {
			t.Fatalf("request pipe was not repaired: %s", fixed["main.vibe"])
		}
		after := toolsCompile(t, w, "FuzzPureRequestPipeReceiver", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("fixed errors: %v source=%v", after.Diagnostics, fixed)
		}
		for name, text := range before.Outputs {
			if strings.HasSuffix(name, ".d.ts") && after.Outputs[name] != text {
				t.Fatalf("declaration %s changed before=%s after=%s", name, text, after.Outputs[name])
			}
		}
	})
}
