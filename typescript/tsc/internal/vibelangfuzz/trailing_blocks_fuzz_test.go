package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const trailingBlocksQuote = "a trailing block: a \x60{\x60 on the same line after a name, a property access or a call"
const trailingBlocksFixQuote = "The rewrite preserves runtime behavior."
const trailingBlocksSeparatorQuote = "suppressing only a redundant missing-separator `TS1005` for the same rejection and retaining independent native errors."
const trailingBlocksBoundaryQuote = "A line break before the block, an optional chain, a heritage clause, and the providers of a \x60provide\x60 block are outside this form."

// Current wording is checked below; historical literals let queued parser
// witnesses keep their independent diagnostic additions.
const compactTrailingBlocksFixQuote = "Preserve runtime behavior and comments;"
const compactTrailingBlocksBoundaryQuote = "A newline before the block, an optional chain, a heritage clause and `provide` providers are outside this form."

func trailingBlocksQuoted(t testing.TB) {
	for file, quote := range map[string]string{
		"900-appendices.md":                      "| \x60EK1101\x60 | " + trailingBlocksQuote,
		"007-tooling.md":                         trailingBlocksFixQuote,
		"../vips/0011-trailing-blocks-denied.md": trailingBlocksSeparatorQuote,
	} {
		if file == "007-tooling.md" {
			quote = compactTrailingBlocksFixQuote
		}
		chapter, err := os.ReadFile(SpecPath(file))
		if err != nil {
			t.Fatal(err)
		}
		if file == "007-tooling.md" && !strings.Contains(string(chapter), compactTrailingBlocksBoundaryQuote) {
			t.Fatalf("chapter 7 no longer says %q", compactTrailingBlocksBoundaryQuote)
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
// Chapter 007 / newline, optional, heritage and provide exclusions: docs/design/src/007-tooling.md#7f084c02e1aa2c27

func FuzzTrailingBlocks(f *testing.F) {
	startShortBudget(f)
	trailingBlocksQuoted(f)
	heads := []string{"name", "property", "call"}
	positions := []string{
		"statement", "return", "variable", "argument", "array", "property-value",
		"conditional-yes", "conditional-no", "binary", "unary", "parentheses",
		"arrow", "if", "while", "for-init", "for-test", "for-update", "switch", "computed",
		"assignment", "binary-left", "logical", "nullish", "conditional-test", "comma", "new-argument", "new-callee", "array-spread", "object-spread", "index", "member", "await", "yield", "yield-star", "throw", "template", "tagged-template", "default-parameter", "destructuring-default", "computed-binding", "for-of", "for-in", "do-while", "switch-case", "class-field", "class-static-field", "class-computed", "class-static", "class-method",
		"vibe-try-operand", "vibe-fork-operand", "vibe-join-operand", "vibe-try-all", "vibe-try-race", "vibe-try-any", "vibe-try-all-settled", "vibe-catch-subject", "vibe-catch-handler-body", "vibe-pipe-left", "vibe-pipe-argument", "vibe-do-result", "vibe-throw-operand", "vibe-concurrent-limit", "vibe-for-try-source", "vibe-match-subject", "vibe-match-arm", "vibe-effect-block", "vibe-yield",
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
	f.Add("boundary:heritage", uint8(0))
	f.Add("boundary:provide", uint8(0))

	// VIP-11 nested native recovery controls.
	f.Add("call:variable", uint8(17)) // nested recovery: neither brace may disappear
	f.Add("call:statement", uint8(17))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value uint8) {
		toolsGuard(t, "FuzzTrailingBlocks", func() {
			// These productions already own their braces. They must not be
			// reinterpreted as a trailing callback, even when the header ends
			// in a call or a provider name. The existing matrix varies newlines
			// and optional chains; these keyed controls complete that boundary.
			if key == "boundary:heritage" || key == "boundary:provide" {
				space := strings.Repeat(" ", int(value%4)+1)
				source := "function Base() { return class {} }\nclass Child extends Base()" + space + "{}\n"
				if key == "boundary:provide" {
					source = "service Key { static readonly key = \"chapter007/trailing\"; value: number }\nconst live = Layer.succeed(Key, {value:1})\neffect function witness() { provide live" + space + "{} }\n"
				}
				r := toolsCompile(t, w, "FuzzTrailingBlocks", map[string]string{"main.vibe": source})
				defer r.Remove()
				for _, d := range r.Diagnostics {
					if IsEK(d) && d.Code() == 1101 {
						Gap(t, "FuzzTrailingBlocks", key, "Chapter 007 %q: a different production consumed this brace; got EK1101\n%s", trailingBlocksBoundaryQuote, source)
					}
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid native/header boundary witness %s: %v", key, r.Diagnostics)
					}
				}
				ExpectPending(t, "FuzzTrailingBlocks", specCorpusKey(t))
				return
			}
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
			contents := fmt.Sprintf("return %d", int(value&15)+1)
			if value&16 != 0 && mode == 0 {
				contents = "return invoke() { " + contents + " }"
				wantCount = 2
			}
			expr := fmt.Sprintf("%s%s{ %s }", head, separator, contents)
			body := ""
			switch positions[p] {
			case "assignment":
				body = "let v: any; v = " + expr + "; return v"
			case "binary-left":
				body = "return " + expr + " + 1"
			case "logical":
				body = "return 1 && " + expr
			case "nullish":
				body = "return undefined ?? " + expr
			case "conditional-test":
				body = "return " + expr + " ? 1 : 0"
			case "comma":
				body = "return (0, " + expr + ")"
			case "new-argument":
				body = "return new Box(" + expr + ")"
			case "new-callee":
				body = "return new (" + expr + ")()"
			case "array-spread":
				body = "return [..." + expr + "]"
			case "object-spread":
				body = "return ({..." + expr + "})"
			case "index":
				body = "return ({1: 7})[" + expr + "]"
			case "member":
				body = "return (" + expr + ").value"
			case "await":
				body = "return await " + expr
			case "yield":
				body = "yield " + expr + "; return 0"
			case "yield-star":
				body = "yield* " + expr + "; return 0"
			case "throw":
				body = "throw " + expr
			case "template":
				body = "return `value${" + expr + "}`"
			case "tagged-template":
				body = "return (" + expr + ")`value`"
			case "default-parameter":
				body = "return ((n = " + expr + ") => n)()"
			case "destructuring-default":
				body = "const [n = " + expr + "] = []; return n"
			case "computed-binding":
				body = "const {[" + expr + "]: n} = {} as any; return n"
			case "for-of":
				body = "for (const n of " + expr + ") { break }; return 0"
			case "for-in":
				body = "for (const n in " + expr + ") { break }; return 0"
			case "do-while":
				body = "do { } while (" + expr + "); return 0"
			case "switch-case":
				body = "switch (1) { case " + expr + ": return 1; default: return 0 }"
			case "class-field":
				body = "class C { n = " + expr + " }; return new C().n"
			case "class-static-field":
				body = "class C { static n = " + expr + " }; return C.n"
			case "class-computed":
				body = "class C { [" + expr + "] = 1 }; return 0"
			case "class-static":
				body = "class C { static { " + expr + "; } }; return C"
			case "class-method":
				body = "class C { m() { return " + expr + " } }; return new C().m()"
			case "vibe-try-operand":
				body = "return try " + expr + ""
			case "vibe-fork-operand":
				body = "const task = fork " + expr + "; return join task"
			case "vibe-join-operand":
				body = "return join " + expr + ""
			case "vibe-try-all":
				body = "return try.all [" + expr + "]"
			case "vibe-try-race":
				body = "return try.race [" + expr + "]"
			case "vibe-try-any":
				body = "return try.any [" + expr + "]"
			case "vibe-try-all-settled":
				body = "return try.allSettled [" + expr + "]"
			case "vibe-catch-subject":
				body = "return (" + expr + " catch () => 0)"
			case "vibe-catch-handler-body":
				body = "return Effect.succeed(1) catch effect () => { return " + expr + " }"
			case "vibe-pipe-left":
				body = "return " + expr + " |> id(%)"
			case "vibe-pipe-argument":
				body = "return 1 |> id([%, " + expr + "])"
			case "vibe-do-result":
				body = "return do { " + expr + " }"
			case "vibe-throw-operand":
				body = "return undefined ?? throw " + expr + ""
			case "vibe-concurrent-limit":
				body = "for concurrent(" + expr + ") (const n of [1]) { }; return 0"
			case "vibe-for-try-source":
				body = "for try (const n of " + expr + ") { break }; return 0"
			case "vibe-match-subject":
				body = "return match (" + expr + ") { default: 0; }"
			case "vibe-match-arm":
				body = "return match (1) { default: " + expr + "; }"
			case "vibe-effect-block":
				body = "return effect { return " + expr + " }"
			case "vibe-yield":
				body = "yield " + expr + "; return"
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
			function := "function"
			if strings.HasPrefix(positions[p], "vibe-") {
				function = "effect function"
			}
			if positions[p] == "vibe-yield" {
				function = "effect function*"
			}
			if positions[p] == "await" {
				function = "async function"
			}
			if strings.HasPrefix(positions[p], "yield") {
				function = "function*"
			}
			source := "function invoke(f?: () => number): any { return f ? f() : invoke }\nconst obj = { invoke }; function id<T>(v: T) { return v }\nclass Box { constructor(readonly value: any) {} }\n" + function + " witness() { " + body + " }"
			r := toolsCompile(t, w, "FuzzTrailingBlocks", map[string]string{"main.vibe": source})
			defer r.Remove()
			count := 0
			seen := map[int]bool{}
			brace := strings.Index(source, expr) + len(head) + len(separator)
			for _, d := range r.Diagnostics {
				if IsEK(d) && d.Code() == 1101 && d.Category() == diagnostics.CategoryError {
					count++
					if seen[d.Pos()] {
						Gap(t, "FuzzTrailingBlocks", "range:duplicate:"+key, "Appendix B: each retired brace has one EK1101; duplicate at %d", d.Pos())
					}
					seen[d.Pos()] = true
					expectedBrace := d.Pos() == brace
					if wantCount == 2 {
						nested := strings.Index(source[brace+1:], "{") + brace + 1
						expectedBrace = expectedBrace || d.Pos() == nested
					}
					if !expectedBrace || d.End() != d.Pos()+1 {
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
