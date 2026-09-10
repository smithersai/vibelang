package compiler

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPinnedForkNativeGeneratedProject(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	checker := backend.(GeneratedProjectChecker)
	t.Run("foreign projections keep their configuration while language roots stay mandatory", func(t *testing.T) {
		request := GeneratedProjectRequest{CurrentDirectory: "/generated", Files: []GeneratedProjectFile{
			{Path: "/generated/foreign.cjs", Text: `export const value: {a?: number} = {a: undefined};`, Configuration: "typescript"},
			{Path: "/generated/main.mjs", Text: `import {value} from "./foreign.cjs"; export const result = value;`},
		}}
		got, err := checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 0 {
			t.Fatalf("charged foreign configuration: %+v err=%v", got, err)
		}
		request.Files[1].Text += ` export const language: {a?: number} = {a: undefined};`
		got, err = checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "TS2375" || got.Diagnostics[0].File != request.Files[1].Path {
			t.Fatalf("lost mandatory root checking: %+v err=%v", got, err)
		}
		request.Files[0].Text = `export const value: number = "bad";`
		got, err = checker.CheckGeneratedProject(ctx, request)
		found := false
		for _, issue := range got.Diagnostics {
			found = found || issue.Code == "TS2322" && issue.File == request.Files[0].Path
		}
		if err != nil || !found {
			t.Fatalf("unchecked foreign projection: %+v err=%v", got, err)
		}
		request.Files[0].Configuration = "guess"
		if _, err := checker.CheckGeneratedProject(ctx, request); err == nil {
			t.Fatal("unknown configuration accepted")
		}
	})
	t.Run("ambient type discovery uses current native wildcard semantics", func(t *testing.T) {
		root := t.TempDir()
		types := filepath.Join(root, "node_modules", "@types", "example")
		if err := os.MkdirAll(types, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(types, "index.d.ts"), []byte(`declare const ambientAnswer: 42; declare module "node:example" { export const answer: 42; }`), 0600); err != nil {
			t.Fatal(err)
		}
		request := GeneratedProjectRequest{CurrentDirectory: filepath.ToSlash(root), DiskDependencies: true, Files: []GeneratedProjectFile{{Path: filepath.ToSlash(filepath.Join(root, "main.ts")), Text: `import {answer} from "node:example"; export const result: 42 = ambientAnswer; export const imported: 42 = answer;`}}}
		got, err := checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 0 {
			t.Fatalf("missing ambient types: %+v err=%v", got, err)
		}
		request.Files[0].Text = `export const wrong: string = ambientAnswer;`
		got, err = checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "TS2322" {
			t.Fatalf("ambient type was any: %+v err=%v", got, err)
		}
		request.DiskDependencies = false
		got, err = checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) == 0 {
			t.Fatalf("ambient types bypass disk opt-in: %+v err=%v", got, err)
		}
	})
	for _, tc := range []struct{ name, path, text, code string }{
		{"valid", "/generated/main.ts", `export const answer: number = 42;`, ""},
		{"typed output js", "/generated/main.js", `export const answer: number = 42;`, ""},
		{"wrong type", "/generated/main.ts", `export const answer: number = "bad";`, "TS2322"},
		{"parse error", "/generated/main.ts", `export const answer = ;`, "TS1109"},
		{"implicit any", "/generated/main.ts", `export function f(x) { return x; }`, "TS7006"},
		{"unchecked indexed access", "/generated/main.ts", `const xs: number[] = []; export const x: number = xs[0];`, "TS2322"},
		{"exact optional", "/generated/main.ts", `export const x: {a?: number} = {a: undefined};`, "TS2375"},
		{"Unicode", "/generated/😀.ts", "// 😀\u2028export const 𝐀: number = \"bad\";", "TS2322"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := checker.CheckGeneratedProject(ctx, GeneratedProjectRequest{Files: []GeneratedProjectFile{{Path: tc.path, Text: tc.text}}, CurrentDirectory: "/generated", DiskDependencies: false})
			if err != nil {
				t.Fatal(err)
			}
			if tc.code == "" {
				if len(got.Diagnostics) != 0 {
					t.Fatalf("unexpected diagnostics: %+v", got)
				}
				return
			}
			found := false
			for _, issue := range got.Diagnostics {
				if issue.Code != tc.code {
					continue
				}
				found = true
				if issue.File != tc.path || issue.Span == nil || issue.Span.Start+issue.Span.Length > utf16Extent(tc.text) {
					t.Fatalf("invalid root span: %+v", issue)
				}
				if tc.name == "Unicode" && (issue.Span.Start != utf16Extent(tc.text[:strings.Index(tc.text, "𝐀")]) || issue.Span.Length != 2) {
					t.Fatalf("not UTF-16: %+v", issue)
				}
			}
			if !found {
				t.Fatalf("missing %s: %+v", tc.code, got)
			}
		})
	}
	t.Run("upstream module paths and generated graph", func(t *testing.T) {
		files := []GeneratedProjectFile{
			{Path: "/generated/main.js", Text: `import { value } from "./nested/dep.js"; import { call } from "vibelang/runtime"; export const seam: "vibelang/runtime" = "vibelang/runtime"; export const answer: number = call(value);`},
			{Path: "/generated/nested/dep.js", Text: `export const value: number = 42;`},
			{Path: "/sdk/runtime.d.ts", Text: `export declare function call(x: number): number;`},
			{Path: "/sdk/runtime.js", Text: `export const unrelated = 0;`},
		}
		request := GeneratedProjectRequest{Files: files, CurrentDirectory: "/generated", ModuleOverrides: map[string]string{"vibelang/runtime": "/sdk/runtime.js"}}
		got, err := checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 0 {
			t.Fatalf("graph: %+v err=%v", got, err)
		}
		request.Files[0].Text = strings.Replace(files[0].Text, "call(value)", `call("bad")`, 1)
		got, err = checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "TS2345" {
			t.Fatalf("lost override type: %+v err=%v", got, err)
		}
	})
	t.Run("full native diagnostic chains survive the wire", func(t *testing.T) {
		got, err := checker.CheckGeneratedProject(ctx, GeneratedProjectRequest{Files: []GeneratedProjectFile{{Path: "/generated/main.ts", Text: `type R<A> = { resume: (answer: A) => void }; declare const r: R<number>; export const x: R<unknown> = r;`}}, CurrentDirectory: "/generated"})
		if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Message != "Type 'R<number>' is not assignable to type 'R<unknown>'.\n  Type 'unknown' is not assignable to type 'number'." {
			t.Fatalf("truncated chain: %+v err=%v", got, err)
		}
	})
	t.Run("authored Result union retains the exact missing-branch refusal", func(t *testing.T) {
		const name = "result-match-requires-both-branches.vibe"
		bytes, err := os.ReadFile(filepath.Join("..", "conformance", "corpus", "01-result-lifting", name))
		if err != nil {
			t.Fatal(err)
		}
		source := string(bytes)
		got, err := backend.Compile(ctx, CompileRequest{RootNames: []string{name}, Files: []SourceFile{{Path: name, Kind: FileKindVibeLang, Text: source}}, Lowering: LoweringInternal})
		if err != nil || !got.EmitSkipped || len(got.Artifacts) != 0 || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "TS2345" {
			t.Fatalf("changed authored refusal: %+v err=%v", got, err)
		}
		issue := got.Diagnostics[0]
		start := strings.Index(source, "{ ok: (value) => value }")
		if start < 0 || issue.File != name || issue.Span == nil || issue.Span.Start != utf16Extent(source[:start]) {
			t.Fatalf("moved authored refusal: %+v", issue)
		}
	})
	t.Run("disk dependencies opt in without execution or writes", func(t *testing.T) {
		dir := t.TempDir()
		dep := filepath.Join(dir, "dep.ts")
		if err := os.WriteFile(dep, []byte(`throw new Error("MUST NOT EXECUTE"); export const value: number = 42; const ownConfiguration: {a?: number} = {a: undefined};`), 0600); err != nil {
			t.Fatal(err)
		}
		request := GeneratedProjectRequest{Files: []GeneratedProjectFile{{Path: filepath.ToSlash(filepath.Join(dir, "main.ts")), Text: `import { value } from "./dep.js"; export const answer: number = value;`}}, CurrentDirectory: filepath.ToSlash(dir)}
		got, err := checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "TS2307" {
			t.Fatalf("implicit disk read: %+v err=%v", got, err)
		}
		request.DiskDependencies = true
		got, err = checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 0 {
			t.Fatalf("dependency own configuration: %+v err=%v", got, err)
		}
		request.Files[0].Text = strings.Replace(request.Files[0].Text, "answer: number", "answer: string", 1)
		got, err = checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "TS2322" {
			t.Fatalf("dependency type absent: %+v err=%v", got, err)
		}
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) != 1 {
			t.Fatalf("filesystem changed: %v err=%v", entries, err)
		}
		// Virtual sources must win over a disk source with the same identity.
		request.Files = append(request.Files, GeneratedProjectFile{Path: filepath.ToSlash(dep), Text: `export const value: string = "virtual";`})
		got, err = checker.CheckGeneratedProject(ctx, request)
		if err != nil || len(got.Diagnostics) != 0 {
			t.Fatalf("disk overrode virtual root: %+v err=%v", got, err)
		}
	})
	t.Run("invalid requests cannot check a different program", func(t *testing.T) {
		for _, request := range []GeneratedProjectRequest{
			{Files: []GeneratedProjectFile{{Path: "main.ts", Text: ""}}, CurrentDirectory: "/src"},
			{Files: []GeneratedProjectFile{{Path: "/src/a/../main.ts", Text: ""}}, CurrentDirectory: "/src"},
			{Files: []GeneratedProjectFile{{Path: "/src/main.vibe", Text: ""}}, CurrentDirectory: "/src"},
			{Files: []GeneratedProjectFile{{Path: "/src/main.ts", Text: ""}, {Path: "/src/main.ts", Text: ""}}, CurrentDirectory: "/src"},
			{Files: []GeneratedProjectFile{}, CurrentDirectory: "."},
			{Files: []GeneratedProjectFile{}, CurrentDirectory: "/src", ModuleOverrides: map[string]string{"a/*": "/sdk/a.ts"}},
			{Files: []GeneratedProjectFile{}, CurrentDirectory: "/src", ModuleOverrides: map[string]string{"./a": "/sdk/a.ts"}},
			{Files: []GeneratedProjectFile{}, CurrentDirectory: "/src", ModuleOverrides: map[string]string{"a": "../sdk/a.ts"}},
			{Files: []GeneratedProjectFile{{Path: "/src/main.ts", Text: strings.Repeat(" ", 2*1024*1024+1)}}, CurrentDirectory: "/src"},
		} {
			if _, err := checker.CheckGeneratedProject(ctx, request); err == nil {
				t.Fatalf("accepted invalid request: %+v", request)
			}
		}
	})
}
