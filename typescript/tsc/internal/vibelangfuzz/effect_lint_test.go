package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime/debug"
	"slices"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// effectLint checks the same sources separately: lint errors must not change
// noEmitOnError, differential execution, or the existing diagnostic oracles.
// A -short run checks one program in every, which still meets a failure that
// reaches most programs (the shim drift of 2026-10-30) and keeps the target
// inside its short budget; campaigns check every program. A lint witness, a
// corpus file named effect-lint-*, always runs. A project too large for the
// tools targets is not checked: compiling it twice outlasts the fuzz
// worker's 60-second limit on a busy host.
type effectLint struct {
	mu     sync.Mutex
	counts map[string]int
	every  uint32
}

func newEffectLint(tb testing.TB, every uint32) *effectLint {
	l := &effectLint{counts: map[string]int{}, every: every}
	tb.Cleanup(func() {
		for _, key := range mapKeys(l.counts) {
			tb.Logf("Effect lint %s: %s count=%d", tb.Name(), key, l.counts[key])
			if isFuzzWorker(os.Args[1:]) {
				fmt.Fprintf(os.Stderr, "Effect lint %s: %s count=%d\n", tb.Name(), key, l.counts[key])
			}
		}
	})
	return l
}

func (l *effectLint) check(t *testing.T, w *Workspace, project Project, key string, witness bool) {
	t.Helper()
	if toolsTooLarge(project.Files) || testing.Short() && !toolsFuzzing() && !witness && seedHash(key)%l.every != 0 {
		return
	}
	// A lint panic is a failure even if a compilation gap is pending. Keeping
	// this program single-threaded gives the input and stack in the report;
	// fatal runtime errors still terminate the test process.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Effect lint panic: %v\n%s", r, debug.Stack())
		}
	}()
	project.Config = effectLintConfig(project.Config)
	var c *Compilation
	within(t, "Effect lint", func() {
		dir, err := w.writeProject(project)
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		c = w.programIn(dir, true)
		if c.Program != nil {
			c.Diagnostics = append(c.Diagnostics, c.Program.GetSemanticDiagnostics(t.Context(), nil)...)
		}
	})
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, d := range c.Diagnostics {
		if importedEffectLint(d) {
			key := fmt.Sprintf("EK%04d %s", d.Code(), d.Category().Name())
			if l.counts[key] == 0 {
				t.Logf("Effect lint observed: %s", key)
			}
			l.counts[key]++
		}
	}
}

// This config belongs only to the lint pass, so JSONC comments and positions
// need not survive serialization. Preserve the project's options and files;
// malformed configs fall back to the harness defaults to still lint sources.
func effectLintConfig(config string) string {
	if config == "" {
		config = DefaultConfig
	}
	value, errors := tsoptions.ParseConfigFileTextToJson(tspath.RootedFilePathFromAbsolute("/tsconfig.json"), "", config)
	root, ok := plainJSON(value).(map[string]any)
	if !ok || len(errors) != 0 {
		value, _ = tsoptions.ParseConfigFileTextToJson(tspath.RootedFilePathFromAbsolute("/tsconfig.json"), "", DefaultConfig)
		root = plainJSON(value).(map[string]any)
	}
	options, ok := root["compilerOptions"].(map[string]any)
	if !ok {
		options = map[string]any{}
		root["compilerOptions"] = options
	}
	// Keep default severities, but execute even off/below-visible rules.
	options["plugins"] = []any{map[string]any{
		"name": "@effect/language-service", "skipDisabledOptimization": true,
	}}
	// A project's release severity settings override the plugin's defaults.
	// They belong to the original oracles, not this independent lint pass.
	if vibe, ok := root["vibe"].(map[string]any); ok {
		delete(vibe, "severities")
	}
	if vibe, ok := options["vibelang"].(map[string]any); ok {
		delete(vibe, "severities")
	}
	data, err := json.Marshal(root)
	if err != nil {
		panic(err)
	}
	return string(data)
}

// plainJSON turns the ordered maps the configuration parser returns into Go
// maps, which encoding/json writes.
func plainJSON(value any) any {
	switch value := value.(type) {
	case *collections.OrderedMap[string, any]:
		out := map[string]any{}
		for key, item := range value.Entries() {
			out[key] = plainJSON(item)
		}
		return out
	case []any:
		out := make([]any, len(value))
		for i, item := range value {
			out[i] = plainJSON(item)
		}
		return out
	}
	return value
}

func importedEffectLint(d *ast.Diagnostic) bool {
	if d.Source() != "EK" {
		return false
	}
	_, ok := core.VibeImportedLintCodes[fmt.Sprintf("EK%04d", d.Code())]
	return ok
}

// Do not compare imported lint diagnostics yet, including in corpus projects
// that explicitly enable the plugin in their own tsconfig.json.
func withoutEffectLint(ds []*ast.Diagnostic) []*ast.Diagnostic {
	return slices.DeleteFunc(ds, importedEffectLint)
}
