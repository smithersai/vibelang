package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// R27 OPUS-2: accepting VIP-41 syntax must not bypass VIP-4's placement
// rule, including literals whose contextual function type admits throws.
// This extends the existing placement target, not the runtime comparator.
const throwExpressionPlacementQuote = "Where a throw is allowed at all remains [VIP-4's no-throw rule](#plain-code-never-throws) (\x60EK0401\x60). This grammar does not authorize a plain function to throw or change eager parameter-initialization rules."

const throwExpressionGrammarQuote = "unary nesting such as \x60!throw error\x60 parse."

var throwExpressionPlacementKeys = []string{
	"expr-plain", "expr-caught", "expr-arrow", "expr-nested-arrow",
	"expr-method", "expr-getter", "expr-generator", "expr-top",
	"expr-field", "expr-static", "expr-parameter", "expr-effect-parameter",
	"expr-effect-thunk", "expr-promise-executor",
	"expr-async", "expr-async-parameter", "expr-effect",
}

func TestThrowExpressionPlacementQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), throwExpressionGrammarQuote) {
		t.Fatalf("Chapter 003 no longer says %q; review the grammar oracle", throwExpressionGrammarQuote)
	}
	if !strings.Contains(SpecText("003-failures.md"), throwExpressionPlacementQuote) {
		t.Fatalf("Chapter 003 no longer says %q; review the placement oracle", throwExpressionPlacementQuote)
	}
}

func throwExpressionPlacementProgram(key string, variant uint8) (string, string, bool) {
	value := fmt.Sprintf("%q", fmt.Sprintf("r27-throw-%d", variant))
	expression := ""
	form := ""
	switch variant & 3 {
	case 0:
		form, expression = "nullish", "input ?? throw "+value
	case 1:
		form, expression = "conditional", "input ? input : throw "+value
	case 2:
		form, expression = "unary", "!throw "+value
	case 3:
		form, expression = "array", "[input, throw "+value+"]"
	}
	body := ""
	wantError := true
	switch key {
	case "expr-plain":
		body = "export function witness() { return " + expression + " }"
	case "expr-caught":
		body = "export function witness() { try { return " + expression + " } catch { return 0 } }"
	case "expr-arrow":
		body = "export const witness = () => " + expression
	case "expr-nested-arrow":
		body = "export effect function witness() { const nested = () => " + expression + "; return nested }"
	case "expr-method":
		body = "export const witness = { value() { return " + expression + " } }"
	case "expr-getter":
		body = "export const witness = { get value() { return " + expression + " } }"
	case "expr-generator":
		body = "export function* witness() { yield " + expression + " }"
	case "expr-top":
		body = "export const witness = " + expression
	case "expr-field":
		body = "export class Witness { value = " + expression + " }"
	case "expr-static":
		body = "export class Witness { static { const value = " + expression + " } }"
	case "expr-parameter":
		body = "export function witness(value = " + expression + ") { return value }"
	case "expr-effect-parameter":
		body = "export effect function witness(value = " + expression + ") { return value }"
	case "expr-effect-thunk":
		body = "export const witness = Effect.try(() => " + expression + ")"
	case "expr-promise-executor":
		body = "export const witness = new Promise((resolve) => { resolve(" + expression + ") })"
	case "expr-async":
		wantError = false
		body = "export async function witness() { return " + expression + " }"
	case "expr-async-parameter":
		wantError = false
		body = "export async function witness(value = " + expression + ") { return value }"
	case "expr-effect":
		wantError = false
		body = "export effect function witness() { return " + expression + " }"
	default:
		panic("unknown throw-expression placement key: " + key)
	}
	return "declare const input: string | undefined\n" + body + "\n", form, wantError
}

func checkThrowExpressionPlacement(t *testing.T, w *Workspace, key string, variant uint8) {
	t.Helper()
	source, form, wantError := throwExpressionPlacementProgram(key, variant)
	file := "main.vibe"
	if variant&4 != 0 {
		file = "main.vibex"
	}
	// Keep distinct pending keys for the lexical form and source suffix:
	// a nullish-body defect cannot hide a broken eager default or JSX parse.
	gapKey := key + ":" + form + ":" + strings.TrimPrefix(file, "main.")
	// The shared workspace's inferred file list currently omits .vibex.
	// List this witness explicitly without changing the protected shared core.
	config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [" + fmt.Sprintf("%q", file) + "]\n}"
	r := toolsCompile(t, w, chapter007OrdinaryThrowsTarget, map[string]string{file: source, "tsconfig.json": config})
	defer r.Remove()
	found := false
	throwStart := strings.Index(source, "throw ")
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if IsEK(d) && d.Code() == 401 && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/"+file) && d.Pos() <= throwStart+len("throw") && d.End() >= throwStart {
			found = true
			continue
		}
		Gap(t, chapter007OrdinaryThrowsTarget, "compile:"+gapKey,
			"unrelated error in the VIP-41 placement witness: %v\n%s", r.Diagnostics, source)
	}
	if found != wantError {
		Gap(t, chapter007OrdinaryThrowsTarget, gapKey,
			"VIP-41 / VIP-4 %q; want EK0401=%t, got %v\n%s",
			throwExpressionPlacementQuote, wantError, r.Diagnostics, source)
	}
	ExpectPending(t, chapter007OrdinaryThrowsTarget, "compile:"+gapKey)
	ExpectPending(t, chapter007OrdinaryThrowsTarget, gapKey)
}

func TestThrowExpressionPlacement(t *testing.T) {
	TestThrowExpressionPlacementQuoted(t)
	w := NewWorkspace(t)
	for _, key := range throwExpressionPlacementKeys {
		for variant := uint8(0); variant < 8; variant++ {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) {
				checkThrowExpressionPlacement(t, w, key, variant)
			})
		}
	}
}

// A saved expression key must reach that expression, rather than the
// compatibility fallback for old or arbitrary byte strings (RULES 11).
func TestThrowExpressionCorpusFocus(t *testing.T) {
	paths, err := filepath.Glob("testdata/fuzz/FuzzChapter007OrdinaryThrows/r27-expr-*")
	if err != nil || len(paths) != 40 {
		t.Fatalf("expected 40 literal R27 corpus inputs: %d, %v", len(paths), err)
	}
	for _, path := range paths {
		t.Run(filepath.Base(path), func(t *testing.T) {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(string(data)), "\n")
			if len(lines) != 3 || lines[0] != "go test fuzz v1" ||
				!strings.HasPrefix(lines[1], "string(") || !strings.HasSuffix(lines[1], ")") ||
				!strings.HasPrefix(lines[2], "byte(") || !strings.HasSuffix(lines[2], ")") {
				t.Fatalf("malformed placement corpus: %s", data)
			}
			key, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "string("), ")"))
			if err != nil {
				t.Fatal(err)
			}
			variant, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimPrefix(lines[2], "byte("), ")"), 10, 8)
			if err != nil {
				t.Fatal(err)
			}
			if selected := chapter007OrdinaryThrowKey(key); selected != key {
				t.Fatalf("corpus key %q silently falls back to %q", key, selected)
			}
			if want := fmt.Sprintf("r27-%s-%d", key, variant); filepath.Base(path) != want {
				t.Fatalf("corpus file %q does not describe its input %q", path, want)
			}
			source, _, _ := throwExpressionPlacementProgram(key, uint8(variant))
			if !strings.Contains(source, "throw ") {
				t.Fatalf("the saved expression input lost its throw: %s", source)
			}
		})
	}
}
