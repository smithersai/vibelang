package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
	"strings"
	"testing"
)

const formatModulePlacementQuote = "a top-level statement of a .vibe or .vibex file only; ModuleBody is TypeScript"

func formatModulePlacementQuoted(t testing.TB) {
	chapterSays(t, "../vips/0040-module-declarations.md", formatModulePlacementQuote)
	chapterSays(t, "007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent.")
}

func TestFormatModulePlacementQuoted(t *testing.T) { formatModulePlacementQuoted(t) }

var formatModulePlacementKeys = []string{"function", "block", "arrow", "method", "static", "provide", "top-named", "top-unnamed"}

func formatModulePlacementSource(key string, mode byte) (string, bool) {
	name := "text"
	if mode&1 != 0 {
		name = "café"
	}
	body := "module " + name + " { export const one = 1 }"
	invalid := true
	switch key {
	case "function":
		body = "function outer(){" + body + "}"
	case "block":
		body = "{" + body + "}"
	case "arrow":
		body = "const outer=()=>{" + body + "}"
	case "method":
		body = "const outer={read(){" + body + "}}"
	case "static":
		body = "class Outer{static{" + body + "}}"
	case "provide":
		body = "effect function outer(){provide Layer.empty{" + body + "}}"
	case "top-unnamed":
		body = "module { export const one=1 }"
		invalid = false
	default:
		invalid = false
	}
	if mode&2 != 0 {
		body = "/* placement */\n" + body + "\n"
	}
	if mode&4 != 0 {
		body = strings.ReplaceAll(body, "\n", "\r\n")
	}
	return body, invalid
}

// VIP-40's placement restriction is grammar. Recovery nodes retain the
// declaration so its owning error can be reported, without admitting it.
func formatNamedModulePlacementError(file *ast.SourceFile) string {
	at := -1
	var visit ast.Visitor
	visit = func(node *ast.Node) bool {
		if parser.IsVibeLangModuleDeclaration(node) && node.Name() != nil && node.Name().Text() != "" && node.Parent != nil && node.Parent.Kind != ast.KindSourceFile {
			at = node.Pos()
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if at >= 0 {
		return fmt.Sprintf("%d: EK4001, named module below the file's top level", at)
	}
	return ""
}

func checkFormatModulePlacement(t *testing.T, key string, mode byte) {
	t.Helper()
	source, invalid := formatModulePlacementSource(key, mode)
	syntax := formatSyntaxError(source)
	if (syntax != "") != invalid {
		t.Fatalf("placement=%s syntax=%q invalid=%v source=%s", key, syntax, invalid, source)
	}
	calls := 0
	host := func(s string) (string, error) { calls++; return s, nil }
	once, err := vibelangfmt.Format("main.vibe", source, host)
	if invalid {
		if err == nil || calls != 0 || once != "" {
			t.Fatalf("invalid placement reached host: calls=%d output=%q error=%v", calls, once, err)
		}
	} else if err != nil || calls == 0 {
		t.Fatalf("valid placement refused: calls=%d error=%v", calls, err)
	}
}

func TestFormatNamedModulePlacement(t *testing.T) {
	formatModulePlacementQuoted(t)
	for _, key := range formatModulePlacementKeys {
		for _, mode := range []byte{0, 1, 2, 7} {
			t.Run(fmt.Sprintf("%s/%d", key, mode), func(t *testing.T) { checkFormatModulePlacement(t, key, mode) })
		}
	}
}

func FuzzFormatNamedModulePlacement(f *testing.F) {
	startShortBudget(f)
	formatModulePlacementQuoted(f)
	for _, key := range formatModulePlacementKeys {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x07"))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		found := false
		for _, known := range formatModulePlacementKeys {
			if key == known {
				found = true
				break
			}
		}
		if !found {
			key = formatModulePlacementKeys[len(data)%len(formatModulePlacementKeys)]
		}
		mode := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			mode = parts[1][0]
		}
		source, invalid := formatModulePlacementSource(key, mode)
		syntax := formatSyntaxError(source)
		if (syntax != "") != invalid {
			Gap(t, "FuzzFormatNamedModulePlacement", key, "%s; syntax=%q invalid=%v source=%s", formatModulePlacementQuote, syntax, invalid, source)
			return
		}
		calls := 0
		host := func(s string) (string, error) { calls++; return s, nil }
		once, err := vibelangfmt.Format("main.vibe", source, host)
		if invalid && (err == nil || calls != 0 || once != "") {
			Gap(t, "FuzzFormatNamedModulePlacement", "refusal:"+key, "%s; calls=%d output=%q error=%v", formatModulePlacementQuote, calls, once, err)
			return
		}
		if !invalid && (err != nil || calls == 0) {
			Gap(t, "FuzzFormatNamedModulePlacement", "valid:"+key, "%s; calls=%d error=%v", formatModulePlacementQuote, calls, err)
			return
		}
		ExpectPending(t, "FuzzFormatNamedModulePlacement", key)
		ExpectPending(t, "FuzzFormatNamedModulePlacement", specCorpusKey(t))
	})
}
