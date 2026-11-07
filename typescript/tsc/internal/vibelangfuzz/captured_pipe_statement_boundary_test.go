package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const capturedPipeASITarget = "FuzzCapturedPipeStatementBoundaries"
const capturedPipeASIQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestCapturedPipeASIQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), capturedPipeASIQuote) {
		t.Fatal("quick-fix preservation rule moved")
	}
}

func FuzzCapturedPipeStatementBoundaries(f *testing.F) {
	startShortBudget(f)
	sources := map[string]string{
		"source":   "const program = Effect.succeed(1)\n// retained pipeline boundary\nprogram.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n",
		"block":    "{\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\n}\nexport const marker = 1\n",
		"case":     "switch (1) { case 1:\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\nbreak\n}\nexport const marker = 1\n",
		"default":  "switch (0) { default:\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\n}\nexport const marker = 1\n",
		"if":       "const program = Effect.succeed(1)\nif (false) program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n",
		"else":     "const program = Effect.succeed(1)\nif (true) {} else program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n",
		"while":    "const program = Effect.succeed(1)\nwhile (false) program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n",
		"do":       "const program = Effect.succeed(1)\ndo program.pipe(Effect.asVoid, Effect.runSync); while (false)\nexport const marker = 1\n",
		"label":    "const program = Effect.succeed(1)\nboundary: program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n",
		"return":   "function use() {\nconst program = Effect.succeed(1)\nreturn program.pipe(Effect.asVoid, Effect.runSync)\n}\nuse()\nexport const marker = 1\n",
		"rhs":      "const program = Effect.succeed(1)\nexport const result = program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n",
		"function": "function use() {\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\n}\nuse()\nexport const marker = 1\n",
	}
	keys := []string{"opencode", "source", "block", "case", "default", "if", "else", "while", "do", "label", "return", "rhs", "function"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	for _, mode := range []uint8{1, 2, 3} {
		f.Add("source", mode)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestCapturedPipeASIQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = "source"
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		source := sources[key]
		if key == "opencode" {
			corpus, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/corpus/opencode-captured-root-pipe.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(corpus) + "\nexport const marker = 1\n"
		}
		source = "import * as Effect from 'effect/Effect'\n" + source
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "Effect.succeed(1)\n", "Effect.succeed(1);\n")
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		native := toolsCompile(t, w, capturedPipeASITarget, map[string]string{"main.ts": source})
		defer native.Remove()
		if !toolsErrorFree(native) {
			t.Fatalf("invalid native twin: %v", native.Diagnostics)
		}
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, capturedPipeASITarget, files)
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil {
			Gap(t, capturedPipeASITarget, key+":fix", "%s: %v", capturedPipeASIQuote, result.Err)
			return
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if strings.Contains(fixed["main.vibe"], ".pipe(") {
			Gap(t, capturedPipeASITarget, key+":repair", "pipeline retained: %s refused=%v", fixed["main.vibe"], result.Refused)
			return
		}
		if strings.Count(fixed["main.vibe"], "// retained pipeline boundary") != strings.Count(source, "// retained pipeline boundary") {
			t.Fatal("leading comment changed")
		}
		after := toolsCompile(t, w, capturedPipeASITarget, fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, capturedPipeASITarget, key+":check", "fixed diagnostics: %v", after.Diagnostics)
			return
		}
		for name, text := range native.Outputs {
			if strings.HasSuffix(name, ".d.ts") && after.Outputs[name] != text {
				Gap(t, capturedPipeASITarget, key+":declaration", "native=%s fixed=%s", text, after.Outputs[name])
			}
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, capturedPipeASITarget, key+":fixed-point", "second repair changes source: %v", again)
		}
	})
}
