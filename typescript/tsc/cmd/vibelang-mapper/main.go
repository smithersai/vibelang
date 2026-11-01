// Command vibelang-mapper is VibeLang's TypeScript 7 content mapper. TypeScript
// starts it from the vibelang-ts-mapper package's manifest and talks to it over
// stdio; see internal/vibelangmapper.
//
//	vibelang-mapper                    serve the content mapper protocol on stdio
//	vibelang-mapper --print f.vibe   print f's virtual TypeScript, its segments and diagnostics
//	vibelang-mapper --emit f.vibe    print f's JavaScript; diagnostics go to stderr
//	vibelang-mapper --emit f.vibe --out f.js
//	                                 write f.js and its source map, f.js.map
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// main serves the protocol, or prints one projection with --print.
func main() {
	if len(os.Args) == 3 && os.Args[1] == "--print" {
		os.Exit(printProjection(os.Args[2]))
	}
	if len(os.Args) == 3 && os.Args[1] == "--emit" {
		os.Exit(emit(os.Args[2], ""))
	}
	if len(os.Args) == 5 && os.Args[1] == "--emit" && os.Args[3] == "--out" {
		os.Exit(emit(os.Args[2], os.Args[4]))
	}
	if len(os.Args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: vibelang-mapper [--print file.vibe | --emit file.vibe [--out file.js]]")
		os.Exit(2)
	}
	if err := vibelangmapper.Serve(context.Background(), stdio{}); err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		os.Exit(1)
	}
}

// printProjection writes the projection of the file at path to stdout, for
// debugging the projector without TypeScript.
func printProjection(path string) int {
	text, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		return 1
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		return 1
	}
	projection := vibelangmapper.Project(string(text), vibelangmapper.FileContextOf(filepath.ToSlash(absolute)))
	fmt.Print(projection.Text)
	fmt.Println("\n// --- segments [virtualStart, virtualEnd) <- [originalStart, originalEnd)")
	for _, s := range projection.Segments {
		fmt.Printf("// [%d, %d) <- [%d, %d)\n", s.VirtualStart, s.VirtualEnd, s.OriginalStart, s.OriginalEnd)
	}
	for _, d := range projection.Diagnostics {
		fmt.Printf("// %s%04d at [%d, %d): %s\n", vibelangmapper.DiagnosticSource, d.Code, d.Start, d.Start+d.Length, d.Message)
	}
	return 0
}

// emit compiles the file at path to JavaScript with vibelangmapper.Emit. With
// out, it writes the JavaScript there, with a sourceMappingURL comment, and
// the source map beside it; without, it prints the JavaScript. Diagnostics
// go to stderr, one per line, as file(line,column): EKcode message. The exit
// status is 1 when the file cannot be read or written or has diagnostics.
// JavaScript is written even for a file with diagnostics, as tsc writes it.
func emit(path string, out string) int {
	text, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		return 1
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		return 1
	}
	js, sourceMap, diagnostics := vibelangmapper.Emit(string(text), vibelangmapper.FileContextOf(filepath.ToSlash(absolute)))
	for _, d := range diagnostics {
		line, column := lineAndColumn(string(text), d.Start)
		fmt.Fprintf(os.Stderr, "%s(%d,%d): error %s%04d: %s\n", path, line, column, vibelangmapper.DiagnosticSource, d.Code, d.Message)
	}
	status := 0
	if len(diagnostics) > 0 {
		status = 1
	}
	if out == "" {
		fmt.Print(js)
		return status
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		return 1
	}
	js += "//# sourceMappingURL=" + filepath.Base(out) + ".map\n"
	if err := os.WriteFile(out, []byte(js), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		return 1
	}
	if err := os.WriteFile(out+".map", []byte(sourceMap), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "vibelang-mapper:", err)
		return 1
	}
	return status
}

// lineAndColumn returns the one-based line and column of pos in text.
func lineAndColumn(text string, pos int) (int, int) {
	pos = min(max(pos, 0), len(text))
	starts := core.ComputeECMALineStarts(text)
	line := scanner.ComputeLineOfPosition(starts, pos)
	return line + 1, int(core.UTF16Len(text[starts[line]:pos])) + 1
}

// stdio joins the process's stdin and stdout into the connection the
// protocol runs on.
type stdio struct{}

// Read reads from stdin.
func (stdio) Read(p []byte) (int, error) { return os.Stdin.Read(p) }

// Write writes to stdout.
func (stdio) Write(p []byte) (int, error) { return os.Stdout.Write(p) }

// Close closes stdin, which ends the read loop.
func (stdio) Close() error { return os.Stdin.Close() }
