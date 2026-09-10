package compiler

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPinnedForkTypeScriptCLI(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	original := backend.(*forkCompiler).executable
	// A relocated executable must carry its standard library. There is no npm
	// TypeScript installation or compiler checkout beside this copy.
	executable := filepath.Join(t.TempDir(), filepath.Base(original))
	bytes, err := os.ReadFile(original)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, bytes, 0o755); err != nil {
		t.Fatal(err)
	}
	identity, err := bridgeBuildIdentity(ctx, executable)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("same source version as the language compiler", func(t *testing.T) {
		command := exec.CommandContext(ctx, executable, "--typescript", "--version")
		output, err := command.CombinedOutput()
		if err != nil || strings.TrimSpace(string(output)) != "Version "+identity.CompilerVersion {
			t.Fatalf("version=%q identity=%+v err=%v", output, identity, err)
		}
	})

	for _, tc := range []struct {
		name, source, extension string
		args                    []string
		wantCode                string
	}{
		{name: "bundled standard libraries", source: `export async function value(): Promise<number> { return new Map([["value", 42]]).get("value")!; }`, extension: ".ts", args: []string{"--noEmit", "--target", "ES2022", "--strict"}},
		{name: "authored type error", source: `export const value: number = "wrong";`, extension: ".ts", args: []string{"--noEmitOnError", "--outDir", "output"}, wantCode: "TS2322"},
		{name: "unknown flag", source: `export const value = 42;`, extension: ".ts", args: []string{"--unknownCompilerOption"}, wantCode: "TS5023"},
		{name: "bridge flag is not a TypeScript flag", source: `export const value = 42;`, extension: ".ts", args: []string{"--build-identity"}, wantCode: "TS5023"},
		{name: "no unchecked language input", source: `export const value = 42;`, extension: ".vibe", args: []string{"--noEmit"}, wantCode: "TS6054"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			name := "source space " + tc.extension
			if err := os.WriteFile(filepath.Join(root, name), []byte(tc.source), 0o644); err != nil {
				t.Fatal(err)
			}
			args := append([]string{"--typescript", "--pretty", "false"}, tc.args...)
			args = append(args, name)
			command := exec.CommandContext(ctx, executable, args...)
			command.Dir = root
			output, err := command.CombinedOutput()
			if tc.wantCode == "" {
				if err != nil || len(output) != 0 {
					t.Fatalf("output=%q err=%v", output, err)
				}
			} else {
				if _, exited := err.(*exec.ExitError); !exited || !strings.Contains(string(output), tc.wantCode) {
					t.Fatalf("expected refusal %s: output=%q err=%v", tc.wantCode, output, err)
				}
				if _, err := os.Stat(filepath.Join(root, "output", "source space .js")); !os.IsNotExist(err) {
					t.Fatalf("refusal published executable output: %v", err)
				}
			}
		})
	}
}
