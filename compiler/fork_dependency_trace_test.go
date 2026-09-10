package compiler

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func TestDependencyTraceValidation(t *testing.T) {
	root := filepath.ToSlash(t.TempDir())
	file := root + "/a.ts"
	for _, tc := range []struct {
		name      string
		trace     *DependencyTrace
		requested bool
		root      string
		valid     bool
	}{
		{"omitted", nil, false, root, true},
		{"missing", nil, true, root, false},
		{"empty", &DependencyTrace{Files: []string{}, Directories: []string{}}, true, root, true},
		{"unexpected", &DependencyTrace{Files: []string{}, Directories: []string{}}, false, root, false},
		{"null files", &DependencyTrace{Directories: []string{}}, true, root, false},
		{"null directories", &DependencyTrace{Files: []string{}}, true, root, false},
		{"ordinary", &DependencyTrace{Files: []string{file}, Directories: []string{root}}, true, root, true},
		{"duplicate", &DependencyTrace{Files: []string{file, file}, Directories: []string{}}, true, root, false},
		{"order", &DependencyTrace{Files: []string{root + "/z", file}, Directories: []string{}}, true, root, false},
		{"relative", &DependencyTrace{Files: []string{"a.ts"}, Directories: []string{}}, true, root, false},
		{"dot segment", &DependencyTrace{Files: []string{root + "/./a.ts"}, Directories: []string{}}, true, root, false},
		{"parent segment", &DependencyTrace{Files: []string{root + "/x/../a.ts"}, Directories: []string{}}, true, root, false},
		{"nul", &DependencyTrace{Files: []string{file + "\x00"}, Directories: []string{}}, true, root, false},
		{"backslash", &DependencyTrace{Files: []string{root + "/a\\b"}, Directories: []string{}}, true, root, false},
		{"outside", &DependencyTrace{Files: []string{root + "-sibling/a"}, Directories: []string{}}, true, root, false},
		{"generated outside", &DependencyTrace{Files: []string{root + "-sibling/a"}, Directories: []string{}}, true, "", true},
		{"long path", &DependencyTrace{Files: []string{root + "/" + strings.Repeat("x", 16*1024)}, Directories: []string{}}, true, root, false},
		{"long UTF8 path", &DependencyTrace{Files: []string{root + "/" + strings.Repeat("é", 9000)}, Directories: []string{}}, true, root, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if validDependencyTrace(tc.trace, tc.requested, tc.root) != tc.valid {
				t.Fatal("incorrect dependency trace verdict")
			}
		})
	}
}

func TestPinnedForkDependencyTrace(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	root := t.TempDir()
	write := func(name, text string) {
		t.Helper()
		name = filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(name), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("node_modules/watched/package.json", `{"name":"watched","types":"index.d.ts"}`)
	write("node_modules/watched/index.d.ts", "/** @module @throws {never} */\nexport declare const value: 42;")
	write("local.ts", "/** @module @throws {never} */\nexport const local = 1;")
	source := `import {value} from "watched"; import {local} from "./local.js"; export const answer = value + local;`
	abs := func(name string) string { return filepath.ToSlash(filepath.Join(root, name)) }
	check := func(trace *DependencyTrace) {
		t.Helper()
		if trace == nil {
			t.Fatal("no trace")
		}
		for _, name := range []string{"node_modules/watched/package.json", "node_modules/watched/index.d.ts", "local.ts"} {
			if !slices.Contains(trace.Files, abs(name)) {
				t.Fatalf("missing %s: %+v", name, trace)
			}
		}
	}
	t.Run("analysis package metadata and declarations", func(t *testing.T) {
		input := LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}, ResolutionRoot: root, TraceDependencies: true}
		result, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, input)
		if err != nil || !result.Checked {
			t.Fatalf("%+v %v", result, err)
		}
		check(result.Dependencies)
		if slices.Contains(result.Dependencies.Files, abs("main.vibe")) {
			t.Fatal("traced overlay as disk")
		}
		input.TraceDependencies = false
		ordinary, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, input)
		if err != nil || ordinary.Dependencies != nil {
			t.Fatalf("%+v %v", ordinary, err)
		}
		result.Dependencies = nil
		if !reflect.DeepEqual(result, ordinary) {
			t.Fatal("tracing changed analysis")
		}
	})
	t.Run("generated package metadata and declarations", func(t *testing.T) {
		input := GeneratedProjectRequest{Files: []GeneratedProjectFile{{Path: abs("main.ts"), Text: source}}, CurrentDirectory: filepath.ToSlash(root), DiskDependencies: true, TraceDependencies: true}
		result, err := backend.(GeneratedProjectChecker).CheckGeneratedProject(ctx, input)
		if err != nil || len(result.Diagnostics) != 0 {
			t.Fatalf("%+v %v", result, err)
		}
		check(result.Dependencies)
		if slices.Contains(result.Dependencies.Files, abs("main.ts")) {
			t.Fatal("traced overlay as disk")
		}
		for _, name := range []string{".", "node_modules", "node_modules/watched"} {
			if slices.Contains(result.Dependencies.Directories, abs(name)) {
				t.Fatalf("positive existence probe would recursively watch an entire ancestor: %s", name)
			}
		}
	})
	t.Run("missing import retains negative probes", func(t *testing.T) {
		input := LanguageAnalysisRequest{Files: []SourceFile{{Path: "missing.vibe", Kind: FileKindVibeLang, Text: `import {value} from "./not-yet.js";export const answer = value;`}}, ResolutionRoot: root, TraceDependencies: true}
		result, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, input)
		if err != nil || result.Checked || result.Dependencies == nil {
			t.Fatalf("%+v %v", result, err)
		}
		if !slices.Contains(result.Dependencies.Files, abs("not-yet.ts")) {
			t.Fatalf("lost negative probe: %+v", result.Dependencies)
		}
	})
	t.Run("missing directory retains negative probe", func(t *testing.T) {
		input := LanguageAnalysisRequest{Files: []SourceFile{{Path: "missing-dir.vibe", Kind: FileKindVibeLang, Text: `import {value} from "./not-a-directory/value.js";export const answer=value;`}}, ResolutionRoot: root, TraceDependencies: true}
		result, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, input)
		if err != nil || result.Checked || result.Dependencies == nil {
			t.Fatalf("%+v %v", result, err)
		}
		if !slices.Contains(result.Dependencies.Directories, abs("not-a-directory")) || slices.Contains(result.Dependencies.Directories, abs(".")) {
			t.Fatalf("wrong directory dependencies: %+v", result.Dependencies)
		}
	})
	t.Run("closed analysis has no disk dependencies", func(t *testing.T) {
		result, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: []SourceFile{}, TraceDependencies: true})
		if err != nil || !result.Checked || !reflect.DeepEqual(result.Dependencies, &DependencyTrace{Files: []string{}, Directories: []string{}}) {
			t.Fatalf("%+v %v", result, err)
		}
	})
	t.Run("closed generated project has no disk dependencies", func(t *testing.T) {
		result, err := backend.(GeneratedProjectChecker).CheckGeneratedProject(ctx, GeneratedProjectRequest{Files: []GeneratedProjectFile{{Path: abs("main.ts"), Text: "export const answer = 42;"}}, CurrentDirectory: filepath.ToSlash(root), TraceDependencies: true})
		if err != nil || len(result.Diagnostics) != 0 || !reflect.DeepEqual(result.Dependencies, &DependencyTrace{Files: []string{}, Directories: []string{}}) {
			t.Fatalf("%+v %v", result, err)
		}
	})
}
