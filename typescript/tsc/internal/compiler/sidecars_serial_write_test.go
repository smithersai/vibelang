package compiler_test

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Declaration emit is parallel, and every caller of EmitDeclarationSidecars
// passes a writer that collects or writes without its own lock. Two sidecars
// written at once made go-compiler-body-imports die with concurrent map writes.
func TestEmitDeclarationSidecarsWritesOneAtATime(t *testing.T) {
	files := map[string]any{
		"/src/package.json":  `{"type":"module"}`,
		"/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true},"include":["*.vibe"]}`,
	}
	for i := range 64 {
		files[fmt.Sprintf("/src/m%d.vibe", i)] = fmt.Sprintf("export const value%d: number = %d\n", i, i)
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
	config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(ds) != 0 {
		t.Fatal(ds)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	var active, peak, written, native atomic.Int32
	result := p.EmitDeclarationSidecars(t.Context(), func(name string, _ string) error {
		if compiler.NativeDeclarationPath(name) == "" {
			native.Add(1) // each module's x.d.ts, written by the same writer
		}
		now := active.Add(1)
		for {
			old := peak.Load()
			if now <= old || peak.CompareAndSwap(old, now) {
				break
			}
		}
		time.Sleep(5 * time.Millisecond)
		active.Add(-1)
		written.Add(1)
		return nil
	})
	if result == nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("sidecar emit: %+v", result)
	}
	if written.Load() != 128 || native.Load() != 64 {
		t.Fatalf("wrote %d files, %d of them native declarations; want 64 sidecars and 64 native declarations", written.Load(), native.Load())
	}
	if peak.Load() != 1 {
		t.Fatalf("%d writers ran at once, want 1", peak.Load())
	}
}
