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
		checkCapturedPipeBoundary(t, w, capturedPipeASITarget, key, source)
	})
}

func checkCapturedPipeBoundary(t *testing.T, w *Workspace, target, key, source string) {
	TestCapturedPipeASIQuoted(t)
	native := toolsCompile(t, w, target, map[string]string{"main.ts": source})
	defer native.Remove()
	if !toolsErrorFree(native) {
		t.Fatalf("invalid native twin: %v", native.Diagnostics)
	}
	files := map[string]string{"main.vibe": source}
	before := toolsCompile(t, w, target, files)
	defer before.Remove()
	result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
	if result.Err != nil {
		Gap(t, target, key+":fix", "%s: %v", capturedPipeASIQuote, result.Err)
		return
	}
	fixed := maps.Clone(files)
	for name, file := range result.Files {
		fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
	}
	if strings.Contains(fixed["main.vibe"], ".pipe(") {
		Gap(t, target, key+":repair", "pipeline retained: %s refused=%v", fixed["main.vibe"], result.Refused)
		return
	}
	if strings.Count(fixed["main.vibe"], "// retained pipeline boundary") != strings.Count(source, "// retained pipeline boundary") {
		t.Fatal("leading comment changed")
	}
	after := toolsCompile(t, w, target, fixed)
	defer after.Remove()
	if !toolsErrorFree(after) {
		Gap(t, target, key+":check", "fixed diagnostics: %v", after.Diagnostics)
		return
	}
	for name, text := range native.Outputs {
		if strings.HasSuffix(name, ".d.ts") && after.Outputs[name] != text {
			Gap(t, target, key+":declaration", "native=%s fixed=%s", text, after.Outputs[name])
		}
	}
	again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
	if again.Err != nil || len(again.Files) != 0 {
		Gap(t, target, key+":fixed-point", "second repair changes source: %v", again)
	}
}

const capturedPipeContinuationTarget = "FuzzCapturedPipeStatementContinuations"

func TestCapturedPipeContinuationsQuoted(t *testing.T) {
	TestCapturedPipeASIQuoted(t)
}

func FuzzCapturedPipeStatementContinuations(f *testing.F) {
	startShortBudget(f)
	pipe := "program.pipe(Effect.map((value: number) => value + 1), Effect.runSync)"
	shapes := map[string]string{
		"satisfies":   pipe + " satisfies number",
		"assertion":   pipe + " as number",
		"property":    pipe + ".toFixed",
		"element":     pipe + "[\"toFixed\"]",
		"binary":      pipe + " + 1",
		"conditional": pipe + " ? 1 : 2",
	}
	shapeKeys := []string{"satisfies", "assertion", "property", "element", "binary", "conditional"}
	decl := "const program = Effect.succeed(1)\n"
	ending := "\nexport const marker = 1\n"
	contexts := map[string][2]string{
		"source":        {decl, ending},
		"block":         {"{\n" + decl, "\n}" + ending},
		"case":          {"switch (1) { case 1:\n" + decl, "\nbreak\n}" + ending},
		"default":       {"switch (0) { default:\n" + decl, "\n}" + ending},
		"function":      {"function use() {\n" + decl, "\n}\nuse()" + ending},
		"if":            {decl + "if (false) ", ending},
		"else":          {decl + "if (true) {} else ", ending},
		"while":         {decl + "while (false) ", ending},
		"do":            {decl + "do ", "; while (false)" + ending},
		"label":         {decl + "boundary: ", ending},
		"return":        {"function use() {\n" + decl + "return ", "\n}\nuse()" + ending},
		"rhs":           {decl + "const result = ", "\nvoid result" + ending},
		"unary":         {decl + "void (", ")" + ending},
		"argument":      {"function consume(_value: unknown): void {}\n" + decl + "consume(", ")" + ending},
		"parenthesized": {"const program = Effect.succeed(1);\n(", ")" + ending},
	}
	contextKeys := []string{"source", "block", "case", "default", "function", "if", "else", "while", "do", "label", "return", "rhs", "unary", "argument", "parenthesized"}
	for _, shape := range shapeKeys {
		for _, context := range contextKeys {
			f.Add(shape, context, uint8(0))
		}
		for _, mode := range []uint8{1, 2, 3} {
			f.Add(shape, "source", mode)
		}
	}
	for _, mode := range []uint8{0, 1, 2, 3} {
		f.Add("opencode", "source", mode)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape, context string, mode uint8) {
		if !slices.Contains(shapeKeys, shape) && shape != "opencode" {
			if shape == "" {
				shape = "satisfies"
			} else {
				shape = shapeKeys[int(shape[0])%len(shapeKeys)]
			}
		}
		if !slices.Contains(contextKeys, context) {
			if context == "" {
				context = "source"
			} else {
				context = contextKeys[int(context[0])%len(contextKeys)]
			}
		}
		parts := contexts[context]
		source := parts[0] + shapes[shape] + parts[1]
		if shape == "opencode" {
			data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/corpus/opencode-captured-pipe-satisfies.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(data) + ending
		}
		source = "import * as Effect from 'effect/Effect'\n" + source
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "Effect.succeed(1)\n", "Effect.succeed(1);\n")
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		checkCapturedPipeBoundary(t, w, capturedPipeContinuationTarget, shape+"/"+context, source)
	})
}
