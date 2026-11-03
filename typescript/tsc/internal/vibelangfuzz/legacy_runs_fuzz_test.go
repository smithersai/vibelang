package vibelangfuzz

import (
	"bytes"
	"maps"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// FuzzVIPLegacyRuns checks the VIP-1 migration against the compiler itself,
// on two inputs the spec says end alike (RULES 1). Chapter 7 scopes
// --fix-vip-only to "The existing VIP migration passes, including the
// VIP-1/VIP-2 function-kind and `try` migration", and decided detail 274
// rules: "A legacy migration preserves the old call's result/run phase".
//
// Before VIP-1 a call in effect code whose result was an Effect ran where it
// stood; VIP-5 runs it only after try ("`try e` runs the Effect `e` inside an
// `effect` function or block and gives its success value"). So a program
// whose every run is written with try, and the same program with the tries
// of its unambiguous run positions removed, are one program: the second is
// how VibeLang before VIP-1 spelled the first. The target takes a program
// (vipgen's, or one written out in an input that starts "program:"), moves one
// tried call into a keyed position (legacyRunPositions), removes the tries,
// runs --fix-vip-only, and compares the result's Exit with the original's,
// with FuzzVIPDifferential's comparison (VIPCompare). A refusal fails too:
// every position here is one the old compiler ran.
//
// An input is "pos:<position>\x00" followed by a vipgen input, or
// "program:<main.vibe>"; keyed corpus files are named after the position,
// and foldkit-option-none-die holds foldkit-18's None arm.
// Chapter 007 / legacy run-site migration preserves execution phase and Exit: docs/design/src/007-tooling.md#ce3a3ee20bb99c91

func FuzzVIPLegacyRuns(f *testing.F) {
	startShortBudget(f)
	leaveOut := vipLeaveOut()
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		if testing.Short() && !legacyRunsShort[corpusFile(t, "FuzzVIPLegacyRuns")] {
			t.Skip("-short runs the corpus files legacyRunsShort names")
		}
		position, main, ok := legacyRunInput(data, leaveOut)
		if !ok {
			t.Skip("the input names no position or program, or every construct it needs is pending")
		}
		files := map[string]string{"main.vibe": main}
		original := legacyCompile(t, env, files)
		defer original.Remove()
		if errors := legacyErrors(original); len(errors) > 0 {
			t.Skipf("the program does not compile: %s", errors[0])
		}
		legacy, moved := legacySource(t, original, position)
		if moved == 0 {
			t.Skip("the program has no tried call in effect code to remove")
		}
		files["main.vibe"] = legacy
		old := legacyCompile(t, env, files)
		defer old.Remove()
		config := toolsConfig(env.w, old.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatalf("config of the legacy program: %v", config)
		}
		var result *vibelang.FixResult
		Within("fix", func() {
			result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		})
		key := position
		if result.Err != nil {
			Gap(t, "FuzzVIPLegacyRuns", "converge/"+key, "--fix-vip-only did not reach a fixed point (%v)\nlegacy:\n%s", result.Err, legacy)
		}
		var report strings.Builder
		result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
		if len(result.Refused) > 0 {
			Gap(t, "FuzzVIPLegacyRuns", "refused/"+key, "--fix-vip-only refused a call the old compiler ran:\n%s\nlegacy:\n%s\noriginal:\n%s", report.String(), legacy, main)
		}
		fixed := maps.Clone(files)
		for _, file := range result.Files {
			fixed["main.vibe"] = file.Text
		}
		after := legacyCompile(t, env, fixed)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPLegacyRuns", "compile/"+key, "the migrated program does not compile: %s\nmigrated:\n%s\nlegacy:\n%s", strings.Join(errors, "\n"), fixed["main.vibe"], legacy)
		}
		want := env.node.RunVIP(original, "out/main.js")
		if want.Kind != "exit" {
			t.Skipf("the original ended %s, not with an Exit", want.Kind)
		}
		got := env.node.RunVIP(after, "out/main.js")
		if aspect, diff := VIPCompare(want, got); aspect != "" {
			Gap(t, "FuzzVIPLegacyRuns", "exit:"+aspect+"/"+key, "the migrated program ends differently from the original: %s\noriginal:\n%s\nlegacy:\n%s\nmigrated:\n%s\n%s", diff, main, legacy, fixed["main.vibe"], got.Log)
		}
	})
}

// legacyRunsShort are the corpus files -short runs, within its budget: the
// repository's own pattern, and the positions that wrap the call in a
// function the parser writes or the source marks.
var legacyRunsShort = map[string]bool{"foldkit-option-none-die": true, "match-arm": true, "catch-handler": true, "effect-arrow": true}

// legacyRunPosition writes a call, its try removed, in a position where the
// old compiler ran it, as an expression with the call's value: call is the
// call's text.
type legacyRunPosition func(call string) string

// legacyRunPositions are the positions the old compiler ran a call in, each
// written so that it gives the call's value and evaluates it once. The
// statement position is the call where it stands.
var legacyRunPositions = map[string]legacyRunPosition{
	"statement":     func(call string) string { return call },
	"conditional":   func(call string) string { return "(legacyYes() ? " + call + " : " + call + ")" },
	"nullish":       func(call string) string { return "(legacyNothing() ?? " + call + ")" },
	"or":            func(call string) string { return "(legacyNo() || " + call + ")" },
	"and":           func(call string) string { return "(legacyYes() && " + call + ")" },
	"match-arm":     func(call string) string { return "match (1) { when 1: " + call + "; default: " + call + "; }" },
	"do-result":     func(call string) string { return "do { " + call + " }" },
	"effect-arrow":  func(call string) string { return "try (effect () => " + call + ")()" },
	"catch-handler": func(call string) string { return "(legacyFail() catch (e) => " + call + ")" },
	"argument":      func(call string) string { return "legacyId(" + call + ")" },
	"element":       func(call string) string { return "[" + call + "][0]" },
	"property":      func(call string) string { return "({ legacyValue: " + call + " }).legacyValue" },
}

// legacyRunHelpers declares what the positions call. Each returns a literal
// type, so a position gives the call's own type.
const legacyRunHelpers = `

function legacyYes(): true {
  return true
}

function legacyNo(): false {
  return false
}

function legacyNothing(): undefined {
  return undefined
}

function legacyId<T>(value: T): T {
  return value
}

error LegacyMiss

effect function legacyFail(): never!LegacyMiss {
  throw new LegacyMiss()
}
`

func legacyRunPositionKeys() []string {
	return slices.Sorted(maps.Keys(legacyRunPositions))
}

// legacyRunInput reads an input: the position and the program's main.vibe.
func legacyRunInput(data []byte, leaveOut map[string]bool) (string, string, bool) {
	if program, ok := bytes.CutPrefix(data, []byte("program:")); ok {
		return "program", string(program), true
	}
	position := ""
	if rest, ok := bytes.CutPrefix(data, []byte("pos:")); ok {
		name, more, found := bytes.Cut(rest, []byte{0})
		if !found {
			return "", "", false
		}
		position, data = string(name), more
	} else if len(data) > 0 {
		keys := legacyRunPositionKeys()
		position, data = keys[int(data[0])%len(keys)], data[1:]
	}
	if legacyRunPositions[position] == nil {
		return "", "", false
	}
	p := vipgen.Generate(data, leaveOut)
	if p == nil || p.Plain {
		return "", "", false
	}
	return position, vipgen.PrintVibe(p) + legacyRunHelpers, true
}

func legacyCompile(t *testing.T, env *vipEnv, files map[string]string) *Result {
	t.Helper()
	var r *Result
	var err error
	Within("compile", func() { r, err = env.w.Compile(t.Context(), Project{Files: files}) })
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func legacyErrors(r *Result) []string {
	var errors []string
	for _, d := range withoutEffectLint(r.Diagnostics) {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, specDiagnosticText(d))
		}
	}
	return errors
}

// legacySource returns main.vibe as VibeLang before VIP-1 wrote it: each
// try before a call whose result is an Effect, in a run position of effect
// code (legacyTried), removed, and the first such call moved into position.
// The program "program" keeps its own positions. It reports how many tries
// it removed.
func legacySource(t *testing.T, r *Result, position string) (string, int) {
	file := r.Program.GetSourceFile(toolsFileName(r.Dir, "main.vibe"))
	if file == nil {
		return "", 0
	}
	c, done := r.Program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	text := file.Text()
	type edit struct {
		start, end int
		text       string
	}
	var edits []edit
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsVibeLangTry != 0 && ast.IsCallExpression(node) && legacyTried(node) {
			callee := node.Expression()
			signature := c.GetResolvedSignature(node)
			if callee.Flags&ast.NodeFlagsReparsed == 0 && signature != nil {
				if returned := c.GetReturnTypeOfSignature(signature); returned.Symbol() != nil && returned.Symbol().Name() == "Effect" {
					start := scanner.SkipTrivia(text, node.Pos())
					from := scanner.SkipTrivia(text, callee.Pos())
					call := text[from:node.End()]
					replacement := call
					if len(edits) == 0 && position != "program" {
						replacement = legacyRunPositions[position](call)
					}
					edits = append(edits, edit{start, node.End(), replacement})
					return false // its arguments keep their tries
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
	for _, e := range edits {
		text = text[:e.start] + e.text + text[e.end:]
	}
	return text, len(edits)
}

// legacyTried reports whether call, written try f(), stands where the old
// compiler ran f() without try: a statement, an unannotated const's
// initializer or a returned value of a function marked effect, reached
// through parentheses, conditional arms, ?? and ||, the right side of &&,
// and the arrows the parser calls in place for a match or a do expression.
func legacyTried(call *ast.Node) bool {
	n := call
	for {
		parent := n.Parent
		switch {
		case parent == nil:
			return false
		case ast.IsParenthesizedExpression(parent):
		case parent.Kind == ast.KindConditionalExpression:
			if parent.AsConditionalExpression().Condition == n {
				return false
			}
		case ast.IsBinaryExpression(parent):
			switch parent.AsBinaryExpression().OperatorToken.Kind {
			case ast.KindQuestionQuestionToken, ast.KindBarBarToken:
			case ast.KindAmpersandAmpersandToken:
				if parent.AsBinaryExpression().Right != n {
					return false
				}
			default:
				return false
			}
		case parent.Kind == ast.KindExpressionStatement, parent.Kind == ast.KindReturnStatement:
			fn := legacyOwner(parent)
			if fn == nil {
				return false
			}
			if !legacyInPlace(fn) {
				return fn.Flags&ast.NodeFlagsVibeLangEffect != 0
			}
			if parent.Kind == ast.KindExpressionStatement {
				return false
			}
			n = fn.Parent.Parent // the call that invokes it
			continue
		case parent.Kind == ast.KindVariableDeclaration:
			list := parent.Parent
			return parent.Initializer() == n && parent.Type() == nil && list != nil && list.Flags&ast.NodeFlagsConst != 0 && legacyOwnerMarked(parent)
		default:
			return false
		}
		n = parent
	}
}

// legacyOwner returns the function whose body holds statement directly.
func legacyOwner(statement *ast.Node) *ast.Node {
	for n := statement.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) {
			return n
		}
	}
	return nil
}

func legacyOwnerMarked(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) {
			if legacyInPlace(n) {
				continue
			}
			return n.Flags&ast.NodeFlagsVibeLangEffect != 0
		}
	}
	return false
}

// legacyInPlace reports whether fn is an arrow the parser writes and calls
// where it stands, as for a match or a do expression: its => has no source
// text, and a call invokes it through parentheses.
func legacyInPlace(fn *ast.Node) bool {
	if fn.Kind != ast.KindArrowFunction || fn.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	paren := fn.Parent
	return paren != nil && ast.IsParenthesizedExpression(paren) && paren.Parent != nil && ast.IsCallExpression(paren.Parent) && paren.Parent.Expression() == paren
}
