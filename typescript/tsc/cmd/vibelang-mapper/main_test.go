package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// captureCommand uses files rather than pipes so a full projection cannot
// block on the stdout pipe buffer. These tests must not run in parallel.
func captureCommand(t *testing.T, command func() int) (int, string, string) {
	t.Helper()
	out, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	errors, err := os.CreateTemp(t.TempDir(), "stderr")
	if err != nil {
		t.Fatal(err)
	}
	defer errors.Close()
	previousOut, previousErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = out, errors
	defer func() { os.Stdout, os.Stderr = previousOut, previousErr }()
	status := command()
	read := func(file *os.File) string {
		data, err := os.ReadFile(file.Name())
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	return status, read(out), read(errors)
}

func sourceFile(t *testing.T, source string) string {
	t.Helper()
	name := filepath.Join(t.TempDir(), "main.vibe")
	if err := os.WriteFile(name, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	return name
}

func TestPrintProjection(t *testing.T) {
	file := sourceFile(t, `export function answer(): number { return 42 }`)
	status, out, errors := captureCommand(t, func() int { return printProjection(file) })
	if status != 0 || errors != "" {
		t.Fatalf("status %d, stderr %s", status, errors)
	}
	for _, want := range []string{"export function answer(): number { return 42 }", "// --- segments", "// ["} {
		if !strings.Contains(out, want) {
			t.Errorf("projection missing %q: %s", want, out)
		}
	}
}

func TestEmitStdout(t *testing.T) {
	file := sourceFile(t, `export function answer(): number { return 42 }`)
	status, out, errors := captureCommand(t, func() int { return emit(file, "") })
	if status != 0 || errors != "" {
		t.Fatalf("status %d, stderr %s", status, errors)
	}
	if !strings.Contains(out, "export function answer()") || !strings.Contains(out, "return 42;") || strings.Contains(out, ": number") || strings.Contains(out, "sourceMappingURL") {
		t.Fatalf("unexpected JavaScript: %s", out)
	}
}

func TestEmitWritesJavaScriptAndSourceMap(t *testing.T) {
	const source = `export function answer(): number { return 42 }`
	file := sourceFile(t, source)
	output := filepath.Join(t.TempDir(), "nested", "answer.js")
	status, stdout, stderr := captureCommand(t, func() int { return emit(file, output) })
	if status != 0 || stdout != "" || stderr != "" {
		t.Fatalf("status %d, stdout %s, stderr %s", status, stdout, stderr)
	}
	js, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(js), "return 42;") || !strings.HasSuffix(string(js), "//# sourceMappingURL=answer.js.map\n") {
		t.Fatalf("unexpected JS: %s", js)
	}
	data, err := os.ReadFile(output + ".map")
	if err != nil {
		t.Fatal(err)
	}
	var mapping struct {
		Version        int      `json:"version"`
		Sources        []string `json:"sources"`
		SourcesContent []string `json:"sourcesContent"`
		Mappings       string   `json:"mappings"`
	}
	if err := json.Unmarshal(data, &mapping); err != nil {
		t.Fatal(err)
	}
	if mapping.Version != 3 || len(mapping.Sources) != 1 || !strings.HasSuffix(mapping.Sources[0], "main.vibe") || len(mapping.SourcesContent) != 1 || mapping.SourcesContent[0] != source || mapping.Mappings == "" {
		t.Fatalf("invalid original-source mapping: %s", data)
	}
}

func TestEmitReadAndWriteErrors(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing.vibe")
	for _, command := range []func() int{func() int { return emit(missing, "") }, func() int { return printProjection(missing) }} {
		status, out, errors := captureCommand(t, command)
		if status != 1 || out != "" || !strings.Contains(errors, "vibelang-mapper:") || !strings.Contains(errors, "missing.vibe") {
			t.Fatalf("status %d, stdout %s, stderr %s", status, out, errors)
		}
	}
	file := sourceFile(t, `export const answer = 42`)
	root := t.TempDir()
	blocker := filepath.Join(root, "file")
	if err := os.WriteFile(blocker, nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, output := range []string{filepath.Join(blocker, "answer.js"), root, filepath.Join(root, "answer.js")} {
		if strings.HasSuffix(output, "answer.js") && filepath.Dir(output) == root {
			if err := os.Mkdir(output+".map", 0700); err != nil {
				t.Fatal(err)
			}
		}
		status, out, errors := captureCommand(t, func() int { return emit(file, output) })
		if status != 1 || out != "" || !strings.Contains(errors, "vibelang-mapper:") {
			t.Fatalf("%s: status %d, stdout %s, stderr %s", output, status, out, errors)
		}
	}
}

func TestLineAndColumnASCII(t *testing.T) {
	for _, tc := range []struct {
		text              string
		pos, line, column int
	}{
		{"", 0, 1, 1}, {"a\nbc", -3, 1, 1}, {"a\nbc", 2, 2, 1}, {"a\nbc", 3, 2, 2}, {"a\nbc", 99, 2, 3}, {"a\r\nb", 3, 2, 1},
	} {
		line, column := lineAndColumn(tc.text, tc.pos)
		if line != tc.line || column != tc.column {
			t.Errorf("%q at %d = (%d,%d), want (%d,%d)", tc.text, tc.pos, line, column, tc.line, tc.column)
		}
	}
}

// CLI diagnostics use the same ECMAScript lines and UTF-16 columns as tsc
// (D34), even when the mapper itself works with UTF-8 byte offsets.
func TestLineAndColumnUnicode(t *testing.T) {
	for _, tc := range []struct {
		text              string
		pos, line, column int
	}{
		{"éx", len("é"), 1, 2},
		{"😀x", len("😀"), 1, 3},
		{"a\rb", len("a\r"), 2, 1},
		{"a\u2028b", len("a\u2028"), 2, 1},
		{"a\u2029b", len("a\u2029"), 2, 1},
		{"é\r\n😀x", len("é\r\n😀"), 2, 3},
	} {
		line, column := lineAndColumn(tc.text, tc.pos)
		if line != tc.line || column != tc.column {
			t.Errorf("%q at %d = (%d,%d), want (%d,%d)", tc.text, tc.pos, line, column, tc.line, tc.column)
		}
	}
}

// Refresh locally with UPDATE_CLI_GOLDENS=1 go test -run ^TestEmitDiagnosticGolden$.
// The refresh fails deliberately. Rerun with the variable unset to verify.
func TestEmitDiagnosticGolden(t *testing.T) {
	if os.Getenv("UPDATE_CLI_GOLDENS") == "1" && os.Getenv("CI") != "" {
		t.Fatal("UPDATE_CLI_GOLDENS is disabled under CI")
	}
	// A Unicode prefix and a Unicode line separator exercise the actual
	// byte-offset-to-tsc-coordinate path, not just the coordinate helper.
	const source = "const title = \"😀\"; import { maybe } from \"./host\"; maybe?.isSome()\u2028maybe?.isSome()"
	file := sourceFile(t, source)
	status, stdout, stderr := captureCommand(t, func() int { return emit(file, "") })
	if status != 1 || stdout == "" {
		t.Fatalf("status %d, stdout %s, stderr %s", status, stdout, stderr)
	}
	got := strings.ReplaceAll(stderr, file, "main.vibe")
	golden := filepath.Join("testdata", "diagnostics.txt")
	if os.Getenv("UPDATE_CLI_GOLDENS") == "1" {
		if err := os.MkdirAll(filepath.Dir(golden), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(golden, []byte(got), 0644); err != nil {
			t.Fatal(err)
		}
		t.Fatal("golden rewritten; rerun without UPDATE_CLI_GOLDENS")
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatalf("diagnostics differ:\ngot: %s\nwant: %s", got, want)
	}
}
