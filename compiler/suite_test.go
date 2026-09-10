package compiler

import (
	"fmt"
	"os"
	"testing"
)

// Semantic tests need independent compilations, not a fresh build of the same
// compiler executable for every fixture. Keep the content-addressed preparation
// cache only for this test process. NewPinnedFork still validates the checkout
// and binary on each call; every Compile still starts a fresh compiler process.
// Preparation/cold-cache tests use their own explicit ForkConfig and TempDir.
var suitePreparedCache string

func TestMain(m *testing.M) {
	var err error
	suitePreparedCache, err = os.MkdirTemp("", "vibelang-go-test-compiler-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "create compiler test cache:", err)
		os.Exit(1)
	}
	code := m.Run()
	if err := os.RemoveAll(suitePreparedCache); err != nil {
		fmt.Fprintln(os.Stderr, "remove compiler test cache:", err)
		code = 1
	}
	os.Exit(code)
}

func TestPinnedTestBackendReusesOnlyPreparedBinary(t *testing.T) {
	first, firstContext := newPinnedTestBackend(t)
	second, secondContext := newPinnedTestBackend(t)
	if first.(*forkCompiler).executable != second.(*forkCompiler).executable || first == second {
		t.Fatal("test backends must independently open the same prepared compiler")
	}
	for _, tc := range []struct {
		backend Compiler
		source  string
		want    string
	}{
		{first, `export function main(){return 21}`, "21"},
		{second, `export function main(){return 42}`, "42"},
	} {
		result, err := tc.backend.Compile(firstContext, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
			Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: tc.source}}})
		if err != nil {
			t.Fatal(err)
		}
		if actual := runPublishedConsumer(t, CompileResult{}, result); actual != tc.want {
			t.Fatalf("a compilation reused another program's answer: %q, expected %q", actual, tc.want)
		}
	}
	invalid, err := second.Compile(secondContext, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
		Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export const broken:number="not a number"`}}})
	if err != nil {
		t.Fatal(err)
	}
	requireCode(t, invalid, "TS2322", "assignable")
	if !invalid.EmitSkipped || len(invalid.Artifacts) != 0 {
		t.Fatal("a refused compilation reused a prior successful artifact")
	}
}
