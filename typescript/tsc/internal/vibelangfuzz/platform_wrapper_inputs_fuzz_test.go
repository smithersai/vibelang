package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const platformWrapperInputsQuote = "Explicit `sync` inputs stay evaluated at the original call site, in order; the callback still runs only when its Effect runs."

func TestPlatformWrapperInputsQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), platformWrapperInputsQuote) {
		t.Fatalf("missing spec quote %q", platformWrapperInputsQuote)
	}
}

var platformWrapperInputBodies = map[string]string{
	"restore":    "if (value === undefined) delete process.env.COMPLETE; else process.env.COMPLETE = value",
	"write":      "process.env.COMPLETE = value",
	"delete":     "delete process.env.COMPLETE",
	"two-writes": "process.env.COMPLETE = value; process.env.SECOND = value",
}

func FuzzPlatformWrapperInputs(f *testing.F) {
	startShortBudget(f)
	for key := range platformWrapperInputBodies {
		for _, mode := range []string{"ordinary", "migration"} {
			f.Add([]byte(key + ":" + mode + "\x00seed"))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestPlatformWrapperInputsQuoted(t)
		key, raw, _ := strings.Cut(string(data), "\x00")
		shape, mode, _ := strings.Cut(key, ":")
		body, ok := platformWrapperInputBodies[shape]
		if !ok {
			shape, body = "restore", platformWrapperInputBodies["restore"]
		}
		if len(raw) > 20 {
			raw = raw[:20]
		}
		// A harmless source comment mutates offsets; companion identity must not depend on them.
		source := "/// <reference path=\"./types-node/index.d.ts\" />\n// " + fmt.Sprintf("%x", raw) + "\n" +
			"export effect function restore(previous: string | undefined) { try sync((value) => { " + body + " }, previous) }\n" +
			"export const read = sync(() => process.env.COMPLETE);\n"
		files := map[string]string{
			"main.vibe": source, "package.json": `{"name":"wrapper-inputs","type":"module"}`,
			"types-node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
			"types-node/index.d.ts":   `export {}; declare global { var process: {env: {[key:string]: string | undefined}} }`,
		}
		before := toolsCompile(t, w, "FuzzPlatformWrapperInputs", files)
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: mode == "migration"})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		if len(result.Refused) != 0 || len(result.Files) != 2 {
			Gap(t, "FuzzPlatformWrapperInputs", "repair/"+key, "expected one preserving companion: %+v", result)
			return
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if relative != "main.vibe" && relative != "main.platform.ts" {
				Gap(t, "FuzzPlatformWrapperInputs", "name/"+key, "unstable companion %s", relative)
				return
			}
			fixed[relative] = file.Text
		}
		if strings.Contains(fixed["main.vibe"], "process.") {
			Gap(t, "FuzzPlatformWrapperInputs", "remaining/"+key, "host access remains")
			return
		}
		after := toolsCompile(t, w, "FuzzPlatformWrapperInputs", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzPlatformWrapperInputs", "check/"+key, "fixed code has errors: %v", after.Diagnostics)
			return
		}
		// The production fix gate also compares declarations byte-for-byte before accepting either file.
		ExpectPending(t, "FuzzPlatformWrapperInputs", key)
	})
}
