package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestStdioStreams(t *testing.T) {
	input, err := os.CreateTemp(t.TempDir(), "stdin")
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	if _, err := input.WriteString("hello"); err != nil {
		t.Fatal(err)
	}
	if _, err := input.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	previous := os.Stdin
	os.Stdin = input
	defer func() { os.Stdin = previous }()
	status, stdout, stderr := captureCommand(t, func() int {
		var buffer [5]byte
		connection := stdio{}
		n, err := connection.Read(buffer[:])
		if err != nil || n != len(buffer) {
			t.Fatalf("read %d: %v", n, err)
		}
		if n, err := connection.Write(buffer[:]); err != nil || n != len(buffer) {
			t.Fatalf("write %d: %v", n, err)
		}
		if err := connection.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err := input.Read(buffer[:]); !errors.Is(err, os.ErrClosed) {
			t.Fatalf("stdin remains open: %v", err)
		}
		return 0
	})
	if status != 0 || stdout != "hello" || stderr != "" {
		t.Fatalf("status %d, stdout %q, stderr %q", status, stdout, stderr)
	}
}

// TestCommandProcesses verifies argument dispatch, actual exit codes and
// separation of stdout/stderr through the compiled command. An instrumented
// binary also measures paths that os.Exit keeps outside in-process tests.
func TestCommandProcesses(t *testing.T) {
	// go test -timeout bounds the instrumented build: a cold `go build -cover`
	// exceeded a fixed two-minute deadline on a 4-vCPU box (#595).
	ctx := t.Context()
	dir := t.TempDir()
	binary := filepath.Join(dir, "vibelang-mapper")
	build := exec.CommandContext(ctx, "go", "build", "-cover", "-coverpkg=github.com/microsoft/TypeScript/tsc/cmd/vibelang-mapper", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build command: %v\n%s", err, output)
	}
	coverage := filepath.Join(dir, "coverage")
	if err := os.Mkdir(coverage, 0755); err != nil {
		t.Fatal(err)
	}
	file := sourceFile(t, `export function answer(): number { return 42 }`)
	invalid := sourceFile(t, `import { maybe } from "./opaque"; maybe?.isSome()`)
	output := filepath.Join(dir, "out", "answer.js")
	const initialize = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"positionEncodings":["utf-8"]}}`
	for _, tc := range []struct {
		name           string
		args           []string
		stdin          string
		status         int
		stdout, stderr string
	}{
		{name: "print", args: []string{"--print", file}, stdout: "export function answer(): number"},
		{name: "emit stdout", args: []string{"--emit", file}, stdout: "export function answer()"},
		{name: "emit file", args: []string{"--emit", file, "--out", output}},
		{name: "missing print source", args: []string{"--print", file + ".missing"}, status: 1, stderr: "vibelang-mapper:"},
		{name: "missing emit source", args: []string{"--emit", file + ".missing"}, status: 1, stderr: "vibelang-mapper:"},
		{name: "diagnostic", args: []string{"--emit", invalid}, status: 1, stdout: "maybe?.isSome()", stderr: "error EK9006:"},
		{name: "unknown argument", args: []string{"--unknown"}, status: 2, stderr: "usage: vibelang-mapper"},
		{name: "missing argument", args: []string{"--emit"}, status: 2, stderr: "usage: vibelang-mapper"},
		{name: "wrong output argument", args: []string{"--emit", file, "--wrong", output}, status: 2, stderr: "usage: vibelang-mapper"},
		{name: "protocol EOF"},
		{name: "initialize protocol", stdin: fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(initialize), initialize), stdout: `"positionEncoding":"utf-8"`},
		{name: "malformed protocol", stdin: "Content-Length: 1\r\n\r\n{", status: 1, stderr: "vibelang-mapper:"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			command := exec.CommandContext(ctx, binary, tc.args...)
			command.Env = append(os.Environ(), "GOCOVERDIR="+coverage)
			command.Stdin = strings.NewReader(tc.stdin)
			var stdout, stderr bytes.Buffer
			command.Stdout, command.Stderr = &stdout, &stderr
			err := command.Run()
			status := 0
			if err != nil {
				var exit *exec.ExitError
				if !errors.As(err, &exit) {
					t.Fatal(err)
				}
				status = exit.ExitCode()
			}
			if status != tc.status || !strings.Contains(stdout.String(), tc.stdout) || !strings.Contains(stderr.String(), tc.stderr) {
				t.Fatalf("status %d, stdout %s, stderr %s", status, &stdout, &stderr)
			}
			if tc.stdout == "" && stdout.Len() != 0 {
				t.Errorf("unexpected stdout: %s", &stdout)
			}
			if tc.stderr == "" && stderr.Len() != 0 {
				t.Errorf("unexpected stderr: %s", &stderr)
			}
		})
	}
	for _, name := range []string{output, output + ".map"} {
		if _, err := os.Stat(name); err != nil {
			t.Fatal(err)
		}
	}
	percent := exec.CommandContext(ctx, "go", "tool", "covdata", "percent", "-i="+coverage)
	if output, err := percent.CombinedOutput(); err != nil {
		t.Fatalf("command coverage: %v\n%s", err, output)
	} else {
		t.Logf("process coverage: %s", output)
	}
}
