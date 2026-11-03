package vibelangfuzz

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const trailingNativeRecoveryQuote = "Ordinary parsing uses TypeScript's statement boundaries and recovery;"

func trailingBlockNativeRecoveryQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("../vips/0011-trailing-blocks-denied.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), trailingNativeRecoveryQuote) {
		t.Fatalf("VIP-11 no longer says %q", trailingNativeRecoveryQuote)
	}
}

func TestTrailingBlockNativeRecoveryQuoted(t *testing.T) {
	trailingBlockNativeRecoveryQuoted(t)
}

// VIP-11 requires native recovery, including contextual names such as async.
// This compares raw syntax and diagnostics against the TypeScript parser;
// typed EK1101 and preserving rewrites remain covered by FuzzTrailingBlocks.
func FuzzTrailingBlockNativeRecovery(f *testing.F) {
	startShortBudget(f)
	trailingBlockNativeRecoveryQuoted(f)
	heads := []string{"async", "async()", "obj.async", "invoke"}
	positions := []string{"statement", "return", "variable", "argument"}
	for _, head := range heads {
		for _, position := range positions {
			for mode := uint8(0); mode < 4; mode++ {
				f.Add(head+":"+position, mode)
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string, value uint8) {
		head, position := heads[int(value)%len(heads)], positions[int(value)%len(positions)]
		for _, h := range heads {
			for _, p := range positions {
				if key == h+":"+p {
					head, position = h, p
				}
			}
		}
		key = fmt.Sprintf("%s:%s:gap-%d", head, position, value%4)
		gap := []string{" ", "\n", " /* keep */ ", " // keep\n"}[value%4]
		expr := fmt.Sprintf("%s%s{ %d }", head, gap, value)
		source := expr
		switch position {
		case "return":
			source = "function witness() { return " + expr + " }"
		case "variable":
			source = "const value = " + expr + ";"
		case "argument":
			source = "consume(" + expr + ");"
		}
		source += "\nexport {}\n"
		parse := func(name string) *ast.SourceFile {
			return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(name), PathKey: tspath.PathKey(name)}, source, core.ScriptKindTS)
		}
		vibe, ts := parse("/main.vibe"), parse("/main.ts")
		shape := func(file *ast.SourceFile) []string {
			var nodes []string
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				nodes = append(nodes, fmt.Sprintf("%v:%d:%d", node.Kind, node.Pos(), node.End()))
				node.ForEachChild(visit)
				return false
			}
			file.AsNode().ForEachChild(visit)
			return nodes
		}
		if got, want := shape(vibe), shape(ts); !reflect.DeepEqual(got, want) {
			Gap(t, "FuzzTrailingBlockNativeRecovery", key, "VIP-11 native AST differs for %s:\n%s\n%v\n%v", key, source, got, want)
		}
		got, want := vibe.Diagnostics(), ts.Diagnostics()
		if len(got) != len(want) {
			Gap(t, "FuzzTrailingBlockNativeRecovery", key, "VIP-11 native diagnostic count differs for %s: %v versus %v", key, got, want)
		}
		for i, d := range got {
			if d.Code() != want[i].Code() || d.Loc() != want[i].Loc() || d.String() != want[i].String() {
				Gap(t, "FuzzTrailingBlockNativeRecovery", key, "VIP-11 native recovery differs for %s: %v versus %v", key, d, want[i])
			}
		}
	})
}
