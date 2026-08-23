package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/smithersai/smithers/compiler"
)

func TestPinnedCLIProcessCompilesDiskRoots(t *testing.T) {
	checkout := os.Getenv("SMITHERS_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set SMITHERS_TYPESCRIPT_FORK to run the executable CLI test")
	}
	repositoryRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(t.TempDir(), "smithersc-go")
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	build := exec.Command("go", "build", "-o", executable, "./cmd/smithersc-go")
	build.Dir = repositoryRoot
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build CLI: %v\n%s", err, output)
	}
	cache := filepath.Join(t.TempDir(), "bridge-cache")

	valid := runCLIProcess(t, repositoryRoot, executable, []string{
		"--fork-checkout", checkout,
		"--fork-cache", cache,
		"--timeout", "3m",
		"compiler/testdata/identity.sm",
	}, 0)
	if valid.EmitSkipped || len(valid.Diagnostics) != 0 {
		t.Fatalf("unexpected valid result: %#v", valid)
	}
	validContents := make(map[string]string, len(valid.Artifacts))
	for _, artifact := range valid.Artifacts {
		validContents[artifact.Path] = string(artifact.Content)
	}
	if _, ok := validContents["compiler/testdata/identity.js"]; !ok {
		t.Fatalf("positional internal lowering omitted the root JavaScript artifact from %d outputs", len(valid.Artifacts))
	}
	if _, ok := validContents["compiler/testdata/identity.js.map"]; !ok {
		t.Fatalf("positional internal lowering omitted the root source map from %d outputs", len(valid.Artifacts))
	}

	invalid := runCLIProcess(t, repositoryRoot, executable, []string{
		"--fork-checkout", checkout,
		"--fork-cache", cache,
		"--timeout", "3m",
		"compiler/testdata/invalid.sm",
	}, 1)
	if !invalid.EmitSkipped || len(invalid.Artifacts) != 0 || len(invalid.Diagnostics) != 1 || invalid.Diagnostics[0].Code != "TS2322" || invalid.Diagnostics[0].File != "compiler/testdata/invalid.sm" {
		t.Fatalf("unexpected invalid result: %#v", invalid)
	}

	multi := runCLIProcess(t, repositoryRoot, executable, []string{
		"--fork-checkout", checkout,
		"--fork-cache", cache,
		"--timeout", "3m",
		"compiler/testdata/multi/main.sm",
		"compiler/testdata/multi/util.sm",
	}, 0)
	if multi.EmitSkipped || len(multi.Diagnostics) != 0 {
		t.Fatalf("unexpected multi-file result: %#v", multi)
	}
	contents := make(map[string]string, len(multi.Artifacts))
	for _, artifact := range multi.Artifacts {
		contents[artifact.Path] = string(artifact.Content)
	}
	mainJS, ok := contents["compiler/testdata/multi/main.js"]
	if !ok {
		t.Fatalf("missing multi-file main.js: %#v", multi.Artifacts)
	}
	if !strings.Contains(mainJS, `from "./util.js"`) {
		t.Fatalf("multi-file runtime import was not rewritten: %q", mainJS)
	}
	if _, ok := contents["compiler/testdata/multi/util.js"]; !ok {
		t.Fatalf("missing multi-file util.js: %#v", multi.Artifacts)
	}
	if !strings.Contains(contents["compiler/testdata/multi/main.js.map"], "multi/main.sm") {
		t.Fatalf("multi-file map lost authored identity: %q", contents["compiler/testdata/multi/main.js.map"])
	}
}

func TestPinnedCLIProcessCompilesExternallyLoweredRequest(t *testing.T) {
	checkout := os.Getenv("SMITHERS_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set SMITHERS_TYPESCRIPT_FORK to run the executable CLI test")
	}
	repositoryRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(t.TempDir(), "smithersc-go")
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	build := exec.Command("go", "build", "-o", executable, "./cmd/smithersc-go")
	build.Dir = repositoryRoot
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build CLI: %v\n%s", err, output)
	}

	authored := "action answer(): number { return 42 }\n"
	lowered := "function answer(): number { return 42 }\nexport const doubled: number = answer() * 2;\n"
	// Line 0 carries two runs — (0,0)→(0,0) and the verbatim resume after
	// `action`→`function` — while the second lowered line is deliberately
	// unmapped generated code.
	request := compiler.CompileRequest{
		RootNames: []string{"main.sm"},
		Files: []compiler.SourceFile{{
			Path: "main.sm",
			Kind: compiler.FileKindSmithers,
			Text: authored,
			Lowered: &compiler.LoweredSource{
				Text:      lowered,
				SourceMap: `{"version":3,"sources":["main.sm"],"names":[],"mappings":"AAAA,QAAM"}`,
			},
		}},
		Lowering: compiler.LoweringExternal,
	}
	requestJSON, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	requestPath := filepath.Join(t.TempDir(), "request.json")
	if err := os.WriteFile(requestPath, requestJSON, 0o644); err != nil {
		t.Fatal(err)
	}
	result := runCLIProcess(t, repositoryRoot, executable, []string{
		"--fork-checkout", checkout,
		"--fork-cache", filepath.Join(t.TempDir(), "bridge-cache"),
		"--timeout", "3m",
		"--request", requestPath,
	}, 0)
	if result.EmitSkipped || len(result.Diagnostics) != 0 || len(result.Artifacts) != 2 {
		t.Fatalf("unexpected lowered CLI result: %#v", result)
	}
	contents := make(map[string]string, len(result.Artifacts))
	for _, artifact := range result.Artifacts {
		contents[artifact.Path] = string(artifact.Content)
	}
	if !strings.Contains(contents["main.js"], "function answer()") {
		t.Fatalf("lowered TypeScript was not emitted: %q", contents["main.js"])
	}
	if !strings.Contains(contents["main.js.map"], `"sources":["../src/main.sm"]`) {
		t.Fatalf("composed map lost authored identity: %q", contents["main.js.map"])
	}
}

// TestPinnedCLIProcessCompilesInternallyLoweredRequest drives the Go-native
// lowering across the real process boundary: the CLI submits an unlowered `.sm`
// request and the pinned bridge returns emitted JavaScript that constructs
// Result variants instead of throwing.
func TestPinnedCLIProcessCompilesInternallyLoweredRequest(t *testing.T) {
	checkout := os.Getenv("SMITHERS_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set SMITHERS_TYPESCRIPT_FORK to run the executable CLI test")
	}
	repositoryRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(t.TempDir(), "smithersc-go")
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	build := exec.Command("go", "build", "-o", executable, "./cmd/smithersc-go")
	build.Dir = repositoryRoot
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build CLI: %v\n%s", err, output)
	}

	authored := "export class Boom extends Error { }\n" +
		"export class Late extends Error { }\n" +
		"export function guard(n: number): Result<number, Boom> {\n" +
		"    if (n < 0) {\n" +
		"        throw new Boom();\n" +
		"    }\n" +
		"    return n;\n" +
		"}\n" +
		"export function cached(hit: boolean): Optional<number> {\n" +
		"    if (hit) {\n" +
		"        return 1;\n" +
		"    }\n" +
		"    return undefined;\n" +
		"}\n" +
		"export async function fetched(n: number): Promise<Result<number, Boom>> {\n" +
		"    return n;\n" +
		"}\n" +
		"export function describe(error: Boom | Late): string {\n" +
		"    return error.match({ Boom: () => \"boom\", Late: () => \"late\" });\n" +
		"}\n"
	requestJSON, err := json.Marshal(compiler.CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     []compiler.SourceFile{{Path: "main.sm", Kind: compiler.FileKindSmithers, Text: authored}},
		Lowering:  compiler.LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	requestPath := filepath.Join(t.TempDir(), "request.json")
	if err := os.WriteFile(requestPath, requestJSON, 0o644); err != nil {
		t.Fatal(err)
	}
	result := runCLIProcess(t, repositoryRoot, executable, []string{
		"--fork-checkout", checkout,
		"--fork-cache", filepath.Join(t.TempDir(), "bridge-cache"),
		"--timeout", "3m",
		"--request", requestPath,
	}, 0)
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("unexpected internally lowered CLI result: %#v", result)
	}
	contents := make(map[string]string, len(result.Artifacts))
	for _, artifact := range result.Artifacts {
		contents[artifact.Path] = string(artifact.Content)
	}
	if strings.Contains(contents["main.js"], "throw new Boom") {
		t.Fatalf("the authored throw survived lowering: %q", contents["main.js"])
	}
	// Every channel the Go lowering owns survives the process boundary: the
	// Result variants, the Optional variants, the async Result lift, and the
	// constructor-keyed nominal error dispatch.
	for _, lowered := range []string{
		"return new __smithersErr(new Boom());",
		"return new __smithersOk(n);",
		"return new __smithersSome(1);",
		"return new __smithersNone();",
		"error instanceof Boom ?",
		"error instanceof Late ?",
	} {
		if !strings.Contains(contents["main.js"], lowered) {
			t.Fatalf("lowered form %q missing: %q", lowered, contents["main.js"])
		}
	}
	if strings.Contains(contents["main.js"], ".match(") {
		t.Fatalf("the authored match survived lowering: %q", contents["main.js"])
	}
	if _, ok := contents["__smithers_prelude.js"]; !ok {
		t.Fatalf("the compiler-owned prelude runtime was not emitted: %v", contents)
	}
}

func runCLIProcess(t *testing.T, directory string, executable string, args []string, expectedExit int) compiler.CompileResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = directory
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	actualExit := 0
	if err != nil {
		var exitError *exec.ExitError
		if !errors.As(err, &exitError) {
			t.Fatalf("execute CLI: %v", err)
		}
		actualExit = exitError.ExitCode()
	}
	if ctx.Err() != nil {
		t.Fatal(ctx.Err())
	}
	if actualExit != expectedExit || stderr.Len() != 0 {
		t.Fatalf("exit=%d want=%d stdout=%q stderr=%q", actualExit, expectedExit, stdout.String(), stderr.String())
	}
	if strings.Contains(stdout.String(), ":null") {
		t.Fatalf("wire result contains null collection: %q", stdout.String())
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	decoder.DisallowUnknownFields()
	var result compiler.CompileResult
	if err := decoder.Decode(&result); err != nil {
		t.Fatalf("decode result: %v\n%s", err, stdout.String())
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		t.Fatalf("expected one JSON value, got extra %#v (%v)", extra, err)
	}
	return result
}
