package vibelang

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// TestCompilerRuntimeCases checks observable results from the native
// acceptance corpus while the checker and all compiler transforms run inside
// the instrumented Go test process. This covers evaluation order, error and
// requirement propagation, handler continuations, resources and concurrency;
// compiling a fixture alone cannot prove these promises.
func TestCompilerRuntimeCases(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	sources, err := filepath.Glob(filepath.Join(root, "typescript/vibelang/cases/*/*.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, source := range sources {
		text, err := os.ReadFile(source)
		if err != nil {
			t.Fatal(err)
		}
		var expected string
		for line := range strings.SplitSeq(string(text), "\n") {
			if value, ok := strings.CutPrefix(line, "// expect-result:"); ok {
				expected = strings.TrimSpace(value)
				break
			}
		}
		if expected == "" {
			continue
		}
		fixture := filepath.Dir(source)
		count++
		t.Run(filepath.Base(fixture), func(t *testing.T) {
			if pending, err := os.ReadFile(filepath.Join(fixture, "pending")); err == nil {
				t.Skipf("existing acceptance gap: %s", pending)
			}
			var want any
			if err := json.Unmarshal([]byte(expected), &want); err != nil {
				t.Fatalf("invalid expected result: %v", err)
			}
			dir := copyCompilerFixture(t, fixture, root)
			fileSystem := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fileSystem, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fileSystem, bundled.LibPath(), nil, nil, nil)})
			all := slices.Clone(config.Errors)
			all = append(all, program.GetSyntacticDiagnostics(t.Context(), nil)...)
			all = append(all, program.GetGlobalDiagnostics(t.Context())...)
			all = append(all, program.GetSemanticDiagnostics(t.Context(), nil)...)
			for _, diagnostic := range all {
				if diagnostic.Category() == diagnostics.CategoryError {
					t.Fatalf("compile error: %s", diagnostic.String())
				}
			}
			result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
				if err := os.MkdirAll(filepath.Dir(string(name)), 0755); err != nil {
					return err
				}
				return os.WriteFile(string(name), []byte(text), 0600)
			}})
			if result.EmitSkipped {
				t.Fatalf("emit skipped: %v", result.Diagnostics)
			}
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Category() == diagnostics.CategoryError {
					t.Fatalf("emit error: %s", diagnostic.String())
				}
			}
			entry := "./out/" + strings.TrimSuffix(filepath.Base(source), ".vibe") + ".js"
			quotedEntry, err := json.Marshal(entry)
			if err != nil {
				t.Fatal(err)
			}
			scheduler, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/late-start-scheduler.mjs"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "late-start-scheduler.mjs"), scheduler, 0600); err != nil {
				t.Fatal(err)
			}
			runner := `import { Effect, Cause, Exit, Scheduler } from "effect";
import { lateStartScheduler } from "./late-start-scheduler.mjs";
import { main } from ` + string(quotedEntry) + `;
const exit = await Effect.runPromiseExit(main(), process.env.VIBELANG_LATE_START === "1" ? { scheduler: lateStartScheduler(Scheduler) } : {});
if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
console.log("@@compiler-result:" + JSON.stringify(exit.value));
`
			if err := os.WriteFile(filepath.Join(dir, "runner.mjs"), []byte(runner), 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, "node", "--no-warnings", "runner.mjs")
			command.Dir = dir
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("execute: %v\n%s", err, output)
			}
			var actual string
			for line := range strings.SplitSeq(string(output), "\n") {
				if value, ok := strings.CutPrefix(line, "@@compiler-result:"); ok {
					actual = value
				}
			}
			var got any
			if err := json.Unmarshal([]byte(actual), &got); err != nil {
				t.Fatalf("no JSON result: %v\n%s", err, output)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("result:\ngot %s\nwant %s", actual, expected)
			}
		})
	}
	if count == 0 {
		t.Fatal("no runnable compiler cases discovered")
	}
	t.Logf("checked %d native compiler runtime cases", count)
}

// The timing benchmark cannot guard against an early heap entry reliably.
// Count private heap-factory accesses in the compiled acceptance fixture,
// including callbacks, accessors, imported helpers and independent cycles.
func TestPlainBridgeBudget(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/recursion-bridge"), root)
	fileSystem := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fileSystem, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fileSystem, bundled.LibPath(), nil, nil, nil)})
	for _, diagnostic := range commandLineDiagnostics(t, config.Errors, program) {
		if diagnostic.Category() == diagnostics.CategoryError {
			t.Fatalf("compile: %s", diagnostic.String())
		}
	}
	result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if err := os.MkdirAll(filepath.Dir(string(name)), 0755); err != nil {
			return err
		}
		return os.WriteFile(string(name), []byte(text), 0600)
	}})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("emit: %v", result.Diagnostics)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "node", "run.mjs")
	command.Dir = dir
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("bridge budget: %v\n%s", err, output)
	}
}
