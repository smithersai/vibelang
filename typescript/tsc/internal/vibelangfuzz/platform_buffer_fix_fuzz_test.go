package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// The rewrite writes a global chapter 5 allows; the rule it must not break is
// the EK4402 row's own: it must "preserve run phase, captures, receiver and
// public types".
const platformBufferAllowedQuote = "web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`"
const platformBufferPreservesQuote = "if the move cannot preserve run phase, captures, receiver and public types"

var platformBufferFixKeys = []string{"call", "utf8", "dashed", "nested", "bytes", "hex", "union"}

func TestPlatformBufferFixQuoted(t *testing.T) { platformBufferFixQuoted(t) }
func platformBufferFixQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{platformBufferAllowedQuote, platformBufferPreservesQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}

// platformBufferUTF8Length is what Buffer.byteLength documents for a string of
// these UTF-16 code units: a lone surrogate counts as U+FFFD's three bytes.
func platformBufferUTF8Length(units []uint16) int {
	total := 0
	for i := 0; i < len(units); i++ {
		u := units[i]
		switch {
		case u < 0x80:
			total++
		case u < 0x800:
			total += 2
		case u >= 0xD800 && u < 0xDC00 && i+1 < len(units) && units[i+1] >= 0xDC00 && units[i+1] < 0xE000:
			total += 4
			i++
		default:
			total += 3
		}
	}
	return total
}

// FuzzPlatformBufferFix: --fix rewrites Buffer.byteLength of a string to
// TextEncoder, the program then has no EK4402 and returns the bytes
// Buffer.byteLength counts, and a call of any other shape keeps its error.
func FuzzPlatformBufferFix(f *testing.F) {
	startShortBudget(f)
	platformBufferFixQuoted(f)
	for _, key := range platformBufferFixKeys {
		f.Add([]byte(key + "\x00a"))
		f.Add([]byte(key + "\x00\xd8\x3d\xde\x00"))
		f.Add([]byte(key + "\x00\xd8\x00z"))
	}
	w := NewWorkspace(f)
	var node *Node
	f.Cleanup(func() {
		if node != nil {
			node.Close()
		}
	})
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(platformBufferFixKeys, key) {
			key = "call"
		}
		var units []uint16
		if len(parts) == 2 {
			raw := []byte(parts[1])
			for i := 0; i+1 < len(raw) && len(units) < 16; i += 2 {
				units = append(units, uint16(raw[i])<<8|uint16(raw[i+1]))
			}
		}
		var literal strings.Builder
		for _, u := range units {
			fmt.Fprintf(&literal, "\\u%04x", u)
		}
		text := `"` + literal.String() + `"`
		body := map[string]string{
			"call":   "Buffer.byteLength(text)",
			"utf8":   `Buffer.byteLength(text, "utf8")`,
			"dashed": `Buffer.byteLength(text, "utf-8")`,
			"nested": "Buffer.byteLength(text) + Buffer.byteLength(`${Buffer.byteLength(text, \"utf8\")}`) - Buffer.byteLength(`${Buffer.byteLength(text)}`)",
			"bytes":  "Buffer.byteLength(new Uint8Array(1))",
			"hex":    `Buffer.byteLength(text, "hex")`,
			"union":  "Buffer.byteLength(text as string | Uint8Array)",
		}[key]
		source := "/// <reference path=\"./types-node/index.d.ts\" />\nconst text: string = " + text + "\nexport effect function main(): number!never!never {\n  return " + body + "\n}\n"
		files := map[string]string{
			"main.vibe":               source,
			"package.json":            `{"name":"platform-buffer-fix","type":"module"}`,
			"types-node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
			"types-node/index.d.ts":   "export {}\ndeclare global {\n  var Buffer: { byteLength(value: string | Uint8Array, encoding?: string): number }\n}\n",
		}
		before := toolsCompile(t, w, "FuzzPlatformBufferFix", files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		if config == nil {
			t.Fatal("missing fix project")
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if key == "bytes" || key == "hex" || key == "union" {
			if strings.Contains(fixed["main.vibe"], "encode(") {
				Gap(t, "FuzzPlatformBufferFix", key, "the fix rewrote a call it cannot preserve:\n%s", fixed["main.vibe"])
				return
			}
			ExpectPending(t, "FuzzPlatformBufferFix", key)
			return
		}
		after := toolsCompile(t, w, "FuzzPlatformBufferFix", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzPlatformBufferFix", key, "the fixed program still has errors: %v\n%s", after.Diagnostics, fixed["main.vibe"])
			return
		}
		if node == nil {
			var err error
			if node, err = NewNode(w.Dir); err != nil {
				t.Fatal(err)
			}
		}
		// "nested" adds and subtracts one length, so every key returns this.
		want := platformBufferUTF8Length(units)
		entry := ""
		for name := range after.Outputs {
			if name == "main.js" || strings.HasSuffix(name, "/main.js") {
				entry = name
			}
		}
		if entry == "" {
			t.Fatal("no main.js output")
		}
		got := node.Run(after, entry, "main")
		if got.Kind != "success" || string(got.Value) != strconv.Itoa(want) {
			Gap(t, "FuzzPlatformBufferFix", key, "bytes of %v: got %+v, want %d\n%s", units, got, want, fixed["main.vibe"])
			return
		}
		ExpectPending(t, "FuzzPlatformBufferFix", key)
	})
}
