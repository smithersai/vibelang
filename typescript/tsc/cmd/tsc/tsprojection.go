package main

import (
	"fmt"
	"io"
	"os"

	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// runTSProjection serves `vibelang --ts-projection <file>`, which vibelang/oxlint
// (packages/compiler/oxlint.mjs) runs once per file: it reads the file's text
// from stdin and writes the file's virtual TypeScript as one JSON object,
// the content mapper protocol's transform result: {text, extension, mappings,
// diagnostics}. mappings is the span map back to the file's text; text outside
// every segment is synthesized. <file> names the file, and its package decides
// the module key. The exit status is 0 for a projection and 2 for a usage error.
func runTSProjection(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: vibelang --ts-projection <file>  (the file's text on stdin)")
		return 2
	}
	text, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang --ts-projection:", err)
		return 2
	}
	context := vibelangmapper.FileContextOf(args[0])
	context.Lint = true
	result, err := vibelangmapper.TransformResult(vibelangmapper.Project(string(text), context))
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang --ts-projection:", err)
		return 2
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		fmt.Fprintln(os.Stderr, "vibelang --ts-projection:", err)
		return 2
	}
	os.Stdout.Write(encoded)
	return 0
}
