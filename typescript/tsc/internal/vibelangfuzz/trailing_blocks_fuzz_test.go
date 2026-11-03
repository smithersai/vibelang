package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const trailingBlocksQuote = "a trailing block: a \x60{\x60 on the same line after a name, a property access or a call"
const trailingBlocksFixQuote = "Preserve runtime behavior and comments;"
const trailingBlocksSeparatorQuote = "suppressing only a redundant missing-separator `TS1005` for the same rejection and retaining independent native errors."
const trailingBlocksBoundaryQuote = "A newline before the block, an optional chain, a heritage clause and `provide` providers are outside this form."

func trailingBlocksQuoted(t testing.TB) {
	for file, quote := range map[string]string{
		"900-appendices.md": "| \x60EK1101\x60 | " + trailingBlocksQuote,
		"007-tooling.md":    trailingBlocksFixQuote,
	} {
		chapter, err := os.ReadFile(SpecPath(file))
		if err != nil {
			t.Fatal(err)
		}
		if file == "007-tooling.md" && !strings.Contains(string(chapter), trailingBlocksBoundaryQuote) {
			t.Fatalf("chapter 7 no longer says %q", trailingBlocksBoundaryQuote)
		}
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("%s no longer says %q", file, quote)
		}
	}
}

func TestTrailingBlocksQuoted(t *testing.T) {
	trailingBlocksQuoted(t)
	for _, code := range toolsFixCodes() {
		if code == 1101 {
			return
		}
	}
	t.Fatal("the Chapter 7 trailing-block codemod is missing from FuzzFix")
}

// Appendix B assigns EK1101 to a same-line trailing block. Generate call,
// identifier and property heads in statement and expression positions; the
// selected key survives reordering. Runtime preservation uses FuzzFix and its
// existing Exit comparison (the trailing-block-* corpus), not another runner.
func FuzzTrailingBlocks(f *testing.F) {
	startShortBudget(f)
	trailingBlocksQuoted(f)
	heads := []string{"name", "property", "call"}
	positions := []string{
		"statement", "return", "variable", "argument", "array", "property-value",
		"conditional-yes", "conditional-no", "binary", "unary", "parentheses",
		"arrow", "if", "while", "for-init", "for-test", "for-update", "switch", "computed",
	}
	for _, head := range heads {
		for _, position := range positions {
			f.Add(head+":"+position, uint8(1))
		}
	}
	for _, head := range heads {
		for _, boundary := range []uint8{33, 65, 97, 129} {
			f.Add(head+":statement", boundary)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value uint8) {
		toolsGuard(t, "FuzzTrailingBlocks", func() {
			h, p := 0, 0
			if len(key) > 0 {
				h = int(key[0]) % len(heads)
				p = int(key[len(key)-1]) % len(positions)
			}
			for i, head := range heads {
				for j, pos := range positions {
					if key == head+":"+pos {
						h, p = i, j
					}
				}
			}
			key = heads[h] + ":" + positions[p]
			head := []string{"invoke", "obj.invoke", "invoke()"}[h]
			mode := int(value>>5) % 5
			key += ":" + []string{"same-line", "newline", "comment", "line-comment", "optional"}[mode]
			separator := " "
			wantCount := 1
			switch mode {
			case 1:
				separator = "\n"
				wantCount = 0
			case 2:
				separator = " /* keep */ "
			case 3:
				separator = " // keep\n"
				wantCount = 0
			case 4:
				head = strings.TrimSuffix(head, "()") + "?.()"
				wantCount = 0
			}
			expr := fmt.Sprintf("%s%s{ return %d }", head, separator, int(value&31)+1)
			body := ""
			switch positions[p] {
			case "statement":
				body = expr + "; return 1"
			case "return":
				body = "return " + expr
			case "variable":
				body = "const v = " + expr + "; return v"
			case "argument":
				body = "return id(" + expr + ")"
			case "array":
				body = "return [" + expr + "][0]"
			case "property-value":
				body = "return ({v: " + expr + "}).v"
			case "conditional-yes":
				body = "return true ? " + expr + " : 0"
			case "conditional-no":
				body = "return false ? 0 : " + expr
			case "binary":
				body = "return 1 + " + expr
			case "unary":
				body = "return +" + expr
			case "parentheses":
				body = "return (" + expr + ")"
			case "arrow":
				body = "return (() => " + expr + ")()"
			case "if":
				body = "if (" + expr + ") return 1; return 0"
			case "while":
				body = "while (" + expr + ") { break }; return 0"
			case "for-init":
				body = "for (let n = " + expr + "; n > 0; n--) { break }; return 0"
			case "for-test":
				body = "for (; " + expr + ";) { break }; return 0"
			case "for-update":
				body = "for (let n = 0; n < 1; " + expr + ") { break }; return 0"
			case "switch":
				body = "switch (" + expr + ") { default: return 1 }"
			case "computed":
				body = "return ({[" + expr + "]: 1})"
			}
			source := "function invoke(f?: () => number): any { return f ? f() : invoke }\nconst obj = { invoke }; function id<T>(v: T) { return v }\nfunction witness() { " + body + " }"
			r := toolsCompile(t, w, "FuzzTrailingBlocks", map[string]string{"main.vibe": source})
			defer r.Remove()
			count := 0
			brace := strings.Index(source, expr) + len(head) + len(separator)
			for _, d := range r.Diagnostics {
				if IsEK(d) && d.Code() == 1101 && d.Category() == diagnostics.CategoryError {
					count++
					if d.Pos() != brace || d.End() != brace+1 {
						Gap(t, "FuzzTrailingBlocks", "range:"+key, "Appendix B: %s; EK1101 range %d:%d, want %d:%d\n%s", trailingBlocksQuote, d.Pos(), d.End(), brace, brace+1, source)
					}
				}
			}
			if count != wantCount {
				Gap(t, "FuzzTrailingBlocks", "diagnostic:"+key, "Appendix B: %s; want %d EK1101, got %d\n%s\n%v", trailingBlocksQuote, wantCount, count, source, r.Diagnostics)
			}
		})
	})
}
