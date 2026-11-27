// Package vibelangwasm compiles single VibeLang (.vibe / .vibex) files in memory
// for the browser playground WebAssembly target and native Go unit tests.
package vibelangwasm

import (
	"time"

	// Register VibeLang compiler hooks on package initialization.
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// CompileRequest describes a single in-memory VibeLang source file to compile.
type CompileRequest struct {
	Filename string `json:"filename"`
	Source   string `json:"source"`
}

// Diagnostic represents a compiler or projector diagnostic in 1-based coordinates.
type Diagnostic struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
	Line     int    `json:"line"`
	Col      int    `json:"col"`
	EndLine  int    `json:"endLine"`
	EndCol   int    `json:"endCol"`
}

// CompileResponse holds emitted outputs, virtual TypeScript projection, and diagnostics.
type CompileResponse struct {
	JS           string       `json:"js"`
	DTS          string       `json:"dts"`
	TSProjection string       `json:"tsProjection"`
	Diagnostics  []Diagnostic `json:"diagnostics"`
	ElapsedMs    float64      `json:"elapsedMs"`
}

// CompileInMemory compiles req using an in-memory VFS, returning JavaScript,
// declarations, the Effect TypeScript projection, diagnostics, and elapsed time.
func CompileInMemory(req CompileRequest) CompileResponse {
	start := time.Now()
	filename := normalizeFilename(req.Filename)
	virtualPath := playgroundDir + "/" + filename

	ctx := vibelangmapper.FileContext{
		FileName:      virtualPath,
		ModuleKey:     moduleKeyFor(filename),
		PreludeModule: "vibelang/prelude",
		Lint:          true,
	}
	projection := vibelangmapper.Project(req.Source, ctx)

	jsOut, dtsOut, progDiags := compileProgram(filename, req.Source)
	if jsOut == "" && req.Source != "" {
		emittedJS, _, _ := vibelangmapper.Emit(req.Source, ctx)
		jsOut = emittedJS
	}

	normalized := dedupeAndSortDiagnostics(progDiags)
	if normalized == nil {
		normalized = []Diagnostic{}
	}

	return CompileResponse{
		JS:           jsOut,
		DTS:          dtsOut,
		TSProjection: projection.Text,
		Diagnostics:  normalized,
		ElapsedMs:    float64(time.Since(start).Microseconds()) / 1000.0,
	}
}
