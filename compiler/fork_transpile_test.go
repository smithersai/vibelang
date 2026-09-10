package compiler

import (
	"context"
	"os/exec"
	"strings"
	"testing"
	"unicode/utf16"
)

// This API deliberately tests erasure, not checking: every caller must already
// have checked a language program, or be emitting trusted ordinary host code.
func TestPinnedForkNativeTranspile(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	transpiler := backend.(Transpiler)
	for _, tc := range []struct {
		name, path, source, module string
		options                    Options
	}{
		{"ES modules", "module.ts", `export const answer: number = 42;`, "module", nil},
		{"CommonJS", "module.ts", `export const answer: number = 42;`, "commonjs", Options{"module": "commonjs"}},
		{"private fields", "module.ts", `class Box { #n: number = 41; get() { return this.#n + 1 } } export const answer = new Box().get();`, "module", Options{"target": "es2019"}},
		{"enum", "module.ts", `enum N { A = 41, B } export const answer = N.B;`, "module", nil},
		{"namespace", "module.ts", `namespace N { export const value: number = 42 } export const answer = N.value;`, "module", nil},
		{"async", "module.ts", `async function compute(): Promise<number> { return 42 } export const answer = compute();`, "module", nil},
		{"JavaScript", "module.js", `export const answer = 42;`, "module", nil},
		{"mts", "module.mts", `export const answer: number = 42;`, "module", nil},
		{"cts", "module.cts", `export const answer: number = 42;`, "commonjs", Options{"module": "commonjs"}},
		{"mjs", "module.mjs", `export const answer = 42;`, "module", nil},
		{"cjs", "module.cjs", `exports.answer = 42;`, "commonjs", Options{"module": "commonjs"}},
		{"TSX", "module.tsx", `const h = (_: unknown, props: {value: number}) => props.value; export const answer = <item value={42}/>;`, "module", Options{"jsx": "react", "jsxFactory": "h"}},
		{"JSX", "module.jsx", `const h = (_, props) => props.value; export const answer = <item value={42}/>;`, "module", Options{"jsx": "react", "jsxFactory": "h"}},
		{"uppercase TS path", "module.TS", `export const answer: number = 42;`, "module", nil},
		{"uppercase JS path", "module.JS", `export const answer = 42;`, "module", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: tc.path, Text: tc.source}}, Options: tc.options})
			if err != nil || len(got.Files) != 1 || got.Files[0].EmitSkipped || len(got.Files[0].Diagnostics) != 0 || got.Files[0].JavaScript == "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			node, err := exec.LookPath("node")
			if err != nil {
				t.Fatal("native transpile execution tests require Node: ", err)
			}
			value := "answer"
			if tc.module == "commonjs" {
				value = "exports.answer"
			}
			command := exec.CommandContext(ctx, node, "--input-type="+tc.module)
			command.Stdin = strings.NewReader(got.Files[0].JavaScript + "\nPromise.resolve(" + value + ").then(value => console.log(JSON.stringify(value)));\n")
			output, err := command.CombinedOutput()
			if err != nil || strings.TrimSpace(string(output)) != "42" {
				t.Fatalf("execution=%q err=%v\n%s", output, err, got.Files[0].JavaScript)
			}
		})
	}

	t.Run("batch does not read or resolve dependencies", func(t *testing.T) {
		got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{
			{Path: "a.ts", Text: `/// <reference path="/missing/host.d.ts" />
import { value } from "not-an-installed-package"; export const answer: number = value;`},
			{Path: "nested/b.ts", Text: `import { answer } from "../a.js"; export { answer };`},
		}})
		if err != nil || len(got.Files) != 2 || got.Files[0].EmitSkipped || got.Files[1].EmitSkipped ||
			!strings.Contains(got.Files[0].JavaScript, `from "not-an-installed-package"`) || !strings.Contains(got.Files[1].JavaScript, `from "../a.js"`) {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	})
	t.Run("not a type checking bypass", func(t *testing.T) {
		const source = `export const answer: number = "not a number";`
		got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "module.ts", Text: source}}})
		if err != nil || len(got.Files) != 1 || got.Files[0].EmitSkipped || len(got.Files[0].Diagnostics) != 0 {
			t.Fatalf("explicit unchecked operation changed semantics: %+v err=%v", got, err)
		}
		checked, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"module.ts"}, Lowering: LoweringTypeScript,
			Files:   []SourceFile{{Path: "module.ts", Kind: FileKindTypeScript, Text: source}},
			Options: Options{"target": "es2022", "module": "esnext", "types": []string{}, "noEmitOnError": true}})
		if err != nil {
			t.Fatal(err)
		}
		requireCode(t, checked, "TS2322", "")
		if !checked.EmitSkipped || len(checked.Artifacts) != 0 {
			t.Fatal("checked compilation emitted the invalid program")
		}
	})
	t.Run("malformed file has no partial emit and keeps authored UTF16 positions", func(t *testing.T) {
		const source = "// 🦀\r\nconst answer = ;"
		got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "bad.ts", Text: source}, {Path: "good.ts", Text: `export const answer = 42;`}}})
		if err != nil || len(got.Files) != 2 || !got.Files[0].EmitSkipped || got.Files[0].JavaScript != "" || got.Files[0].SourceMap != "" || got.Files[1].EmitSkipped {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		want := len(utf16.Encode([]rune(source[:strings.Index(source, ";")])))
		for _, diagnostic := range got.Files[0].Diagnostics {
			if diagnostic.Code == "TS1109" && diagnostic.File == "bad.ts" && diagnostic.Span != nil && diagnostic.Span.Start == want && diagnostic.Phase == PhaseParse {
				return
			}
		}
		t.Fatalf("missing authored parse position: %+v", got.Files[0].Diagnostics)
	})
	t.Run("source map retains original content and path", func(t *testing.T) {
		const source = "// 🦀\r\nexport const answer: number = 42;"
		got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "nested/🦀.ts", Text: source}}, Options: Options{"sourceMap": true, "inlineSources": true}})
		if err != nil || len(got.Files) != 1 || got.Files[0].EmitSkipped {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		parsed, points := decodeEmittedMap(t, got.Files[0].SourceMap)
		if parsed.Version != 3 || len(parsed.Sources) != 1 || parsed.Sources[0] != "🦀.ts" || len(parsed.SourcesContent) != 1 || parsed.SourcesContent[0] == nil || *parsed.SourcesContent[0] != source || len(points) == 0 {
			t.Fatalf("source map lost authored identity: %+v", parsed)
		}
	})
	for _, source := range []string{"", "interface Value { n: number }", "// comment\nexport type Value = number;"} {
		t.Run("empty runtime output "+source, func(t *testing.T) {
			got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "module.ts", Text: source}}, Options: Options{"removeComments": true}})
			if err != nil || len(got.Files) != 1 || got.Files[0].EmitSkipped || len(got.Files[0].Diagnostics) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	for _, name := range []string{"module.vibe", "module.VIBEX", "module.vibe.ts", "module.VIBE.TS", "module.d.ts", "module.d.MTS", "module.d.cts", "module.json", "../escape.ts", "/host.ts", "C:/host.ts", "nul\x00.ts"} {
		t.Run("refuses path "+name, func(t *testing.T) {
			got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: name, Text: `export const answer = 42;`}}})
			if err == nil {
				t.Fatalf("invalid path accepted: %+v", got)
			}
		})
	}
	for _, options := range []Options{
		{"target": "not-a-target"}, {"module": 1}, {"removeComments": "yes"}, {"misspelledOption": true},
		{"noCheck": false}, {"noEmit": false}, {"noEmitOnError": true}, {"outDir": "/outside"}, {"moduleResolution": "bundler"},
		{"paths": map[string]any{"*": []string{"/host/*"}}}, {"declaration": true}, {"lib": []string{"es2022"}},
	} {
		t.Run("invalid options", func(t *testing.T) {
			got, err := transpiler.Transpile(ctx, TranspileRequest{Files: []TranspileSource{{Path: "module.ts", Text: ""}}, Options: options})
			if err == nil {
				t.Fatalf("invalid options accepted: %+v, got=%+v", options, got)
			}
		})
	}
	for _, files := range [][]TranspileSource{nil, {}, make([]TranspileSource, 4097), {{Path: "module.ts"}, {Path: "./module.ts"}}} {
		t.Run("invalid source set", func(t *testing.T) {
			if got, err := transpiler.Transpile(ctx, TranspileRequest{Files: files}); err == nil {
				t.Fatalf("invalid source set accepted: %+v", got)
			}
		})
	}
	t.Run("cancelled call cannot emit", func(t *testing.T) {
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		if got, err := transpiler.Transpile(cancelled, TranspileRequest{Files: []TranspileSource{{Path: "module.ts", Text: "export const answer = 42;"}}}); err == nil {
			t.Fatalf("cancelled request accepted: %+v", got)
		}
	})
}
