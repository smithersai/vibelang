package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// fixGateBoundsInput is a FuzzFixGateBounds input: m modules, each with g
// good fixes; a refused fix in each module whose index is at modulo every,
// read by the module d after it; a hub that reads the refused fixes of the
// first hub of those modules, or none for 0; the round's checks before its
// first checkpoint (cp) and its bound on checks (iso); and the program
// whose build stops the run, or 0 for none.
type fixGateBoundsInput struct {
	m, g, every, at, d, hub, cp, iso, stop int
}

// fixGateBoundsParse reads input, with defaults and clamps: up to 160
// modules, opencode's witness's 352 fixes, and a stop at program 200 at
// most.
func fixGateBoundsParse(input string) fixGateBoundsInput {
	p := fixGateBoundsInput{m: 12, g: 2, every: 5, at: 0, d: 1, cp: 16, iso: 256}
	for _, pair := range strings.Split(input, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(pair), "=")
		n, err := strconv.Atoi(value)
		if !ok || err != nil {
			continue
		}
		switch key {
		case "m":
			p.m = n
		case "g":
			p.g = n
		case "every":
			p.every = n
		case "at":
			p.at = n
		case "d":
			p.d = n
		case "cp":
			p.cp = n
		case "iso":
			p.iso = n
		case "stop":
			p.stop = n
		case "hub":
			p.hub = n
		}
	}
	clamp := func(n, low, high int) int { return min(max(n, low), high) }
	p.stop = clamp(p.stop, 0, 200)
	p.m = clamp(p.m, 2, 160)
	p.g = clamp(p.g, 0, 3)
	p.every = clamp(p.every, 2, 10)
	p.at = clamp(p.at, 0, p.every-1)
	p.d = clamp(p.d, 1, p.every-1)
	p.cp = clamp(p.cp, 1, 256)
	p.iso = clamp(p.iso, 8, 1024)
	p.hub = clamp(p.hub, 0, 24)
	return p
}

// fixGateBoundsProject writes the project p describes: modules
// m000.vibe to m<p.m-1>.vibe, each importing the one before it, a
// plain.ts that each build reads once, and a main.vibe.
func fixGateBoundsProject(p fixGateBoundsInput) map[string]string {
	files := map[string]string{"main.vibe": "export const main = 1\n", "plain.ts": "export const plain = 1\n"}
	for i := range p.m {
		var b strings.Builder
		if i == 0 {
			b.WriteString("export function f0(x: number): number { return x }\n")
		} else {
			fmt.Fprintf(&b, "import { f%d } from \"./m%03d.vibe\"\nexport function f%d(x: number): number { return f%d(x) + 1 }\n", i-1, i-1, i, i-1)
		}
		for k := range p.g {
			fmt.Fprintf(&b, "export type T%d_%d = Effect.Effect<number>\n", i, k)
		}
		if i%p.every == p.at {
			fmt.Fprintf(&b, "export effect function modes%d() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n", i)
		} else if j := i - p.d; j >= 0 && j%p.every == p.at {
			fmt.Fprintf(&b, "export const more%d: ReturnType<(typeof import(\"./m%03d.vibe\"))[\"modes%d\"]> extends (\"fast\"[]!!) ? false : true = true\n", i, j, j)
		}
		files[fmt.Sprintf("m%03d.vibe", i)] = b.String()
	}
	if hubbed := fixGateBoundsHubbed(p); len(hubbed) > 0 {
		var b, reads strings.Builder
		for k, i := range hubbed {
			fmt.Fprintf(&b, "import { modes%d } from \"./m%03d.vibe\"\n", i, i)
			if k > 0 {
				reads.WriteString(" | ")
			}
			fmt.Fprintf(&reads, "(ReturnType<typeof modes%d> extends (\"fast\"[]!!) ? true : false)", i)
		}
		fmt.Fprintf(&b, "export const any: true extends %s ? false : true = true\n", reads.String())
		files["hub.vibe"] = b.String()
	}
	return files
}

// fixGateBoundsHubbed returns the modules whose refused fixes the hub
// reads.
func fixGateBoundsHubbed(p fixGateBoundsInput) []int {
	var hubbed []int
	for i := 0; i < p.m && len(hubbed) < p.hub; i++ {
		if i%p.every == p.at {
			hubbed = append(hubbed, i)
		}
	}
	return hubbed
}

// fixGateBoundsFS is a workspace's file system that counts builds and
// still shares the workspace's parsed library and package files, as the
// --fix runs of FuzzFixGate do.
type fixGateBoundsFS struct {
	vfs.FS
	shared vfs.FS
}

func (fs fixGateBoundsFS) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if shared, ok := fs.shared.(interface {
		GetSourceFile(ast.SourceFileParseOptions) *ast.SourceFile
	}); ok {
		return shared.GetSourceFile(opts)
	}
	return nil
}

// TestFixGateBoundsProjectShape checks that the opencode witness's input
// describes its project: 160 modules with 352 fixes, 32 of which add an
// error to another file.
func TestFixGateBoundsProjectShape(t *testing.T) {
	p := fixGateBoundsParse("m=160,g=2,every=5,at=0,d=1,cp=16,iso=256,stop=60")
	files := fixGateBoundsProject(p)
	fixes, refused := 0, 0
	for _, text := range files {
		fixes += strings.Count(text, "Effect.Effect<number>") + strings.Count(text, "try Effect.succeed(\"fast\")")
		refused += strings.Count(text, "try Effect.succeed(\"fast\")")
	}
	readers := slices.DeleteFunc(slices.Collect(maps.Values(files)), func(text string) bool { return !strings.Contains(text, "[\"modes") })
	if p.m != 160 || p.stop != 60 || fixes != 352 || refused != 32 || len(readers) != 32 {
		t.Fatalf("%+v: %d fixes, %d refused, %d readers; want 160 modules, 352 fixes, 32 refused, 32 readers, stopped at 60", p, fixes, refused, len(readers))
	}
}
