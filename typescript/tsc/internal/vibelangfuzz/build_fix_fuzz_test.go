package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const buildFixOrderQuote = "With `-b`, each project fixes its own files in build order."
const buildFixCommentsQuote = "preserving JSONC comments, unrelated settings and existing modern entries"

func checkBuildFixQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("007-tooling.md")
	for _, quote := range []string{buildFixOrderQuote, buildFixCommentsQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 007 lost %q", quote)
		}
	}
}
func TestBuildFixOrderQuoted(t *testing.T) { checkBuildFixQuoted(t) }

// Static ownership/order oracle from VIP-34 / chapter 007, not runtime semantics.
// Every node migrates only its config, exactly once and after its dependencies.
func FuzzBuildFixOrder(f *testing.F) {
	startShortBudget(f)
	checkBuildFixQuoted(f)
	f.Add("chain-off")
	f.Fuzz(func(t *testing.T, key string) {
		shape, severity, ok := strings.Cut(key, "-")
		if !ok {
			severity = "off"
		}
		switch shape {
		case "chain", "diamond", "shared", "multi":
		default:
			shape = "chain"
		}
		if severity != "off" && severity != "warning" {
			severity = "off"
		}
		key = shape + "-" + severity
		graph := map[string][]string{"leaf": nil, "mid": {"leaf"}, "root": {"mid"}}
		order := []string{"leaf", "mid", "root"}
		roots := []string{"root"}
		switch shape {
		case "diamond":
			graph = map[string][]string{"leaf": nil, "left": {"leaf"}, "right": {"leaf"}, "root": {"left", "right"}}
			order = []string{"leaf", "left", "right", "root"}
		case "shared":
			graph = map[string][]string{"leaf": nil, "mid": {"leaf"}, "root": {"mid", "leaf", "mid"}}
		case "multi":
			graph = map[string][]string{"leaf": nil, "left": {"leaf"}, "right": {"leaf"}}
			order = []string{"leaf", "left", "right"}
			roots = []string{"left", "right", "leaf"}
		}
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{\"type\":\"module\"}"), 0600); err != nil {
			t.Fatal(err)
		}
		before := map[string]string{}
		write := func(name, text string) {
			t.Helper()
			p := filepath.Join(dir, name)
			if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p, []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
		for name, refs := range graph {
			references := make([]map[string]string, 0, len(refs))
			for _, ref := range refs {
				references = append(references, map[string]string{"path": "../" + ref})
			}
			config := map[string]any{
				"compilerOptions": map[string]any{"composite": true, "noEmit": true, "types": []string{}, "skipLibCheck": true},
				"files":           []string{"main.vibe"}, "references": references,
				"vibe":     map[string]any{"effectGlobals": false, "effectModules": false, "severities": map[string]string{"EK4841": "off"}},
				"vibelang": map[string]any{"diagnostics": map[string]string{"EK4609": severity, "EK0801": severity}},
			}
			data, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			text := "// keep owner " + name + "\n" + string(data) + "\n"
			write(name+"/tsconfig.json", text)
			write(name+"/main.vibe", "export const n=1\n")
			write(name+"/native.ts", "export const native=2\n")
		}
		write("unrelated/tsconfig.json", "{\"files\":[],\"vibelang\":{\"diagnostics\":{\"EK4609\":\"off\"}}}\n")
		read := func(name string) string {
			t.Helper()
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			return string(data)
		}
		unrelated := read("unrelated/tsconfig.json")
		sys := &sidecarParitySystem{fs: bundled.WrapFS(osvfs.FS()), cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir))}
		args := append([]string{"--build"}, roots...)
		status := vibelang.FixWithOptions(t.Context(), sys, args, vibelang.FixOptions{})
		if status != 0 {
			Gap(t, "FuzzBuildFixOrder", key, "build repair rejected: status=%d %s", status, sys.output.String())
			return
		}
		previous := -1
		for _, name := range order {
			needle := "vibelang --fix: " + name + "/tsconfig.json: migrated"
			at := strings.Index(sys.output.String(), needle)
			if at < 0 || at < previous || strings.Count(sys.output.String(), needle) != 1 {
				Gap(t, "FuzzBuildFixOrder", key, "not once in build order at %s: %s", name, sys.output.String())
			}
			previous = at
			text := read(name + "/tsconfig.json")
			before[name] = text
			if strings.Contains(text, "\"vibelang\"") || !strings.Contains(text, "\"severities\"") || !strings.Contains(text, "// keep owner "+name) || !strings.Contains(text, "\"EK4841\"") {
				Gap(t, "FuzzBuildFixOrder", key, "config migration lost settings/comment at %s: %s", name, text)
			}
			if text := read(name + "/native.ts"); text != "export const native=2\n" {
				Gap(t, "FuzzBuildFixOrder", key, "foreign source edited: %s", text)
			}
		}
		if got := read("unrelated/tsconfig.json"); got != unrelated {
			Gap(t, "FuzzBuildFixOrder", key, "unreferenced project edited")
		}
		sys.output.Reset()
		if status := vibelang.FixWithOptions(t.Context(), sys, args, vibelang.FixOptions{}); status != 0 {
			Gap(t, "FuzzBuildFixOrder", key, "second run failed: %d %s", status, sys.output.String())
		}
		for name, text := range before {
			if read(name+"/tsconfig.json") != text {
				Gap(t, "FuzzBuildFixOrder", key, "second run edited %s", name)
			}
		}
		ExpectPending(t, "FuzzBuildFixOrder", key)
	})
}
