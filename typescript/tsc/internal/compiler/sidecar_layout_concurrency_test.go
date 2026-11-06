package compiler

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

type sidecarProbeCountingFS struct {
	vfs.FS
	requests atomic.Int32
	reads    atomic.Int32
	ready    chan struct{}
	release  chan struct{}
	callers  int32
}

func (f *sidecarProbeCountingFS) FileExists(file tspath.RootedFilePath) bool {
	if file == "/lib/tsconfig.json" && f.requests.Add(1) == f.callers {
		close(f.ready)
	}
	return f.FS.FileExists(file)
}
func (f *sidecarProbeCountingFS) ReadFile(file tspath.RootedFilePath) (string, bool) {
	if file == "/lib/src/value.vibe" {
		f.reads.Add(1)
		<-f.release
	}
	return f.FS.ReadFile(file)
}

func TestRelocatedSidecarLayoutConcurrentCacheFill(t *testing.T) {
	for _, test := range []struct {
		name, root, sidecar, want string
		reads                     int32
	}{
		{"inferred root", "", "/lib/types/value.d.vibe.ts", "/lib/src/value.vibe", 1},
		{"explicit root", `,"rootDir":"src"`, "/lib/types/value.d.vibe.ts", "/lib/src/value.vibe", 0},
		{"unowned declaration", "", "/lib/other/value.d.vibe.ts", "", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			const callers = 24
			raw := vfstest.FromMap(map[string]any{
				"/lib/package.json":          `{"type":"module"}`,
				"/lib/tsconfig.json":         `{"compilerOptions":{"noLib":true,"noEmit":true,"module":"preserve","moduleResolution":"bundler"` + test.root + `},"vibe":{"effectGlobals":false,"effectModules":false,"sidecarDir":"types"},"files":["src/value.vibe"]}`,
				"/lib/src/value.vibe":        `export const value = 1`,
				"/lib/types/value.d.vibe.ts": `export declare const value: 1;`,
				"/lib/other/value.d.vibe.ts": `export declare const value: 1;`,
			}, tspath.CaseSensitive)
			config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/lib/tsconfig.json", &core.CompilerOptions{}, nil, raw, nil)
			if len(ds) > 0 || len(config.Errors) > 0 {
				t.Fatalf("configuration: %v %v", ds, config.Errors)
			}
			fs := &sidecarProbeCountingFS{FS: raw, ready: make(chan struct{}), release: make(chan struct{}), callers: callers}
			host := &compilerResolutionHost{host: NewCompilerHost(fs, "/", nil, nil, nil), baseDirectory: "/"}
			host.sidecarConfigs.Store(fs.CaseSensitivity().PathKey("/lib/tsconfig.json"), config)
			var wg sync.WaitGroup
			values := make([]tspath.RootedFilePath, callers)
			for i := range callers {
				wg.Go(func() {
					values[i] = host.ResolveVibeSidecarSource(tspath.RootedFilePathFromNormalized(test.sidecar), "/lib")
				})
			}
			select {
			case <-fs.ready:
			case <-time.After(10 * time.Second):
				close(fs.release)
				wg.Wait()
				t.Fatal("parallel ownership requests did not reach the configuration")
			}
			close(fs.release)
			wg.Wait()
			for _, value := range values {
				if string(value) != test.want {
					t.Fatalf("source=%q, want %q", value, test.want)
				}
			}
			if reads := fs.reads.Load(); reads != test.reads {
				t.Fatalf("owning source read %d times for %d concurrent imports; want %d layout reads", reads, callers, test.reads)
			}
		})
	}
}
