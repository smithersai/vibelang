package vibelang

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixPlatformWrapperPreservesDeclaration(t *testing.T) {
	for _, wrapper := range []string{
		"Effect.try(() => window.location.origin)",
		"Effect.try(() => { /* keep adapter comment */ return window.location.origin; })",
		"Effect.try(() => performance.now())",
		"Effect.try(() => crypto.getRandomValues(new Uint8Array(2)))",
		"Effect.try({ try: () => window.location.origin, catch: (e) => e })",
		"sync(() => document.title)",
		"Effect.sync(() => document.title)",
		"Effect.tryPromise(async () => document.title)",
		"tryPromise(async () => document.title)",
	} {
		t.Run(wrapper, func(t *testing.T) {
			prefix := ""
			if strings.HasPrefix(wrapper, "tryPromise(") {
				prefix = "import { tryPromise } from \"effect/Effect\";\n"
			}
			program, file, _, _ := editorProgram(t, prefix+"export effect function probe() { return try "+wrapper+"; }\n")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == errorCategory && d.Source() != diagnosticSource {
					t.Fatalf("invalid fixture: %s", d.String())
				}
			}
			dir := filepath.Dir(file.FileName().AsString())
			result := fixCase(t, dir)
			if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 2 {
				t.Fatalf("expected a verified two-file migration: %+v", result)
			}
			for name, fixed := range result.Files {
				if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			again := fixCase(t, dir)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
}

func TestFixPlatformWrapperRefusesCapturesAndExistingFiles(t *testing.T) {
	for _, test := range []struct {
		source, why string
		existing    bool
	}{
		{"export effect function probe(prefix: string) { return try Effect.try(() => prefix + window.location.origin); }", "captures prefix", false},
		{"export class C { prefix = 'x'; effect probe() { return try Effect.try(() => this.prefix + window.location.origin); } }", "lexical receiver", false},
		{"export effect function probe() { return try Effect.try(() => window.location.origin); }", "already exists", true},
	} {
		t.Run(test.why, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, test.source)
			dir := filepath.Dir(file.FileName().AsString())
			existing := filepath.Join(dir, "main.platform-"+"0.ts")
			if test.existing {
				pos := strings.Index(test.source, "Effect.try")
				existing = filepath.Join(dir, "main.platform-"+fmt.Sprint(pos)+".ts")
				if err := os.WriteFile(existing, []byte("export const sentinel = 7\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			result := fixCase(t, dir)
			if len(result.Refused) != 1 || !strings.Contains(result.Refused[0].Error, test.why) {
				t.Fatalf("missing refusal %q: %+v", test.why, result)
			}
			for name := range result.Files {
				if strings.Contains(name.AsString(), ".platform-") {
					t.Fatal("refused migration created a foreign module")
				}
			}
			if test.existing {
				got, _ := os.ReadFile(existing)
				if string(got) != "export const sentinel = 7\n" {
					t.Fatalf("overwrote foreign file: %s", got)
				}
			}
		})
	}
}

func TestFixPlatformWrapperStaysCold(t *testing.T) {
	_, file, _, _ := editorProgram(t, "\"use client\";\nexport effect function probe() { return try Effect.try(() => window.location.origin); }\n")
	dir := filepath.Dir(file.FileName().AsString())
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 2 {
		t.Fatalf("migration: %+v", result)
	}
	if fixed := result.Files[file.FileName()]; fixed == nil || !strings.HasPrefix(fixed.Text, "\"use client\";") {
		t.Fatal("migration displaced the file directive")
	}
	for name, fixed := range result.Files {
		if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == errorCategory {
			t.Fatalf("fixed program: %s", d.String())
		}
	}
	p.Emit(t.Context(), compiler.EmitOptions{ForceEmit: true, EmitOnly: compiler.EmitOnlyJs, WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		return os.WriteFile(name.AsString(), []byte(text), 0600)
	}})
	script := `
import { Effect } from "effect";
import { probe } from "./main.js";
let reads = 0;
globalThis.window = { location: { get origin() { reads++; return "origin-"+reads; } } };
if (reads !== 0) throw Error("host work during module initialization");
const effect = probe();
if (reads !== 0) throw Error("host work while building Effect");
const first = await Effect.runPromise(effect);
const second = await Effect.runPromise(effect);
if (first !== "origin-1" || second !== "origin-2" || reads !== 2) throw Error("host work lost coldness/repeatability");
console.log("cold and repeatable");
`
	if err := os.WriteFile(filepath.Join(dir, "run.mjs"), []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), "node", "run.mjs")
	command.Dir = dir
	output, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "cold and repeatable") {
		t.Fatalf("runtime: %v\n%s", err, output)
	}
}

func TestFixPlatformWrapperMissingPrelude(t *testing.T) {
	_, file, _, _ := editorProgramWith(t, "export effect function probe() { return try sync(() => window.location.origin); }", map[string]string{})
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	for name := range result.Files {
		if strings.Contains(name.AsString(), ".platform-") {
			t.Fatal("unresolved wrapper was extracted")
		}
	}
}
