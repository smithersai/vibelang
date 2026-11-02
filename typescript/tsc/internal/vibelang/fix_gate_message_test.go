package vibelang

import (
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fixProjectOf writes files, with effect installed, and runs --fix over them.
func fixProjectOf(t *testing.T, files map[string]string) *FixResult {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime"} {
		if err := os.Symlink(filepath.Join(root, target), filepath.Join(dir, "node_modules", name)); err != nil {
			t.Fatal(err)
		}
	}
	var names []string
	for name := range files {
		names = append(names, `"`+name+`"`)
	}
	files["package.json"] = `{"type":"module"}`
	files["tsconfig.json"] = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"files":[` + strings.Join(names, ",") + `]}`
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	return FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{})
}

// t3code's contracts: makeEntityId builds a schema, so --fix writes its plain
// return type (EK1001). A test elsewhere already fails to decode a struct of
// those ids for an unrelated reason, and the fix only makes that error's
// message name brand<…> where it named Effect<brand<…>>. The gate compared
// errors by message, so it read the rewritten message as a new error and
// refused the fix, which left every schema built from the helper an Effect.
func TestFixGateKeepsFixThatRewritesAnExistingErrorsMessage(t *testing.T) {
	const helper = "import * as Schema from \"effect/Schema\"\n" +
		"const makeThreadId = () => Schema.String.pipe(Schema.brand(\"ThreadId\"))\n" +
		"export const ThreadId = makeThreadId()\n"
	// The error the program reports before and after the fix, at one place.
	const user = "import { ThreadId } from \"./ids.vibe\"\n" +
		"export const count: number = ThreadId\n"
	result := fixProjectOf(t, map[string]string{"ids.vibe": helper, "user.vibe": user})
	if len(result.Refused) != 0 {
		t.Fatalf("--fix refused the helper's plain return type: %+v", result.Refused)
	}
	var fixed string
	for name, f := range result.Files {
		if strings.HasSuffix(name.AsString(), "ids.vibe") {
			fixed = f.Text
		}
	}
	if !strings.Contains(fixed, "const makeThreadId = (): ") {
		t.Fatalf("--fix did not keep makeThreadId plain:\n%s", fixed)
	}
}

// The same gate still refuses a fix whose program reports an error at a
// place that had none: the fixed helper's id is a string where user.vibe
// passes it to a function that takes an Effect.
func TestFixGateRefusesAnErrorAtANewPlace(t *testing.T) {
	const helper = "import * as Schema from \"effect/Schema\"\n" +
		"const makeThreadId = () => Schema.String.pipe(Schema.brand(\"ThreadId\"))\n" +
		"export const ThreadId = makeThreadId()\n"
	const user = "import { Effect } from \"effect\"\n" +
		"import { ThreadId } from \"./ids.vibe\"\n" +
		"const needsEffect = (e: Effect.Effect<unknown>): string => \"ok\"\n" +
		"export const used: string = needsEffect(ThreadId)\n"
	result := fixProjectOf(t, map[string]string{"ids.vibe": helper, "user.vibe": user})
	if len(result.Refused) == 0 {
		t.Fatalf("--fix wrote a fix that adds an error at a new place: %+v", result.Files)
	}
}

// fixedText returns the text --fix wrote for the file whose name ends in
// suffix, or "".
func fixedText(result *FixResult, suffix string) string {
	for name, f := range result.Files {
		if strings.HasSuffix(name.AsString(), suffix) {
			return f.Text
		}
	}
	return ""
}

// t3code's packages/shared/src/otelEnvironment.ts: a plain function calls two
// unannotated Config helpers, and EK9203 reports its first call. Annotating
// that helper's return type is right, and the edit moves the function's one EK9203, which
// now names the second call; the gate read it as a new error, refused the
// fix, and the module reverted (drive-t3code, inbox migrate-t3code.md,
// 2026-11-01T04:04Z, fix:sibling-diagnostic-refuses-fix).
func TestFixGateKeepsFixThatLeavesASiblingErrorAfterIt(t *testing.T) {
	const settings = "import * as Config from \"effect/Config\"\n" +
		"const endpoint = (name: string) => Config.String(name)\n" +
		"const protocol = (name: string) => Config.String(name)\n" +
		"export interface Settings { readonly endpoint: string; readonly protocol: string }\n" +
		"export const settings = (prefix: string): Config.Config<Settings> =>\n" +
		"  Config.all({ endpoint: endpoint(prefix + \"ENDPOINT\"), protocol: protocol(prefix + \"PROTOCOL\") })\n"
	result := fixProjectOf(t, map[string]string{"settings.vibe": settings})
	if len(result.Refused) != 0 {
		t.Fatalf("--fix refused a Config helper's annotation: %+v", result.Refused)
	}
	fixed := fixedText(result, "settings.vibe")
	// Each helper gets a return annotation, which makes it a plain factory.
	for _, helper := range []string{"const endpoint = (name: string): ", "const protocol = (name: string): "} {
		if !strings.Contains(fixed, helper) {
			t.Fatalf("--fix did not write %q:\n%s", helper, fixed)
		}
	}
}

// An edited file's error after the edit that lies where the file had none is
// still new: the fixed helper's id is a string where the same file passes it
// to a function that takes an Effect.
func TestFixGateRefusesAnErrorAfterTheEditAtANewPlace(t *testing.T) {
	const ids = "import { Effect } from \"effect\"\n" +
		"import * as Schema from \"effect/Schema\"\n" +
		"const makeThreadId = () => Schema.String.pipe(Schema.brand(\"ThreadId\"))\n" +
		"export const ThreadId = makeThreadId()\n" +
		"const needsEffect = (e: Effect.Effect<unknown>): string => \"ok\"\n" +
		"export const used: string = needsEffect(ThreadId)\n"
	result := fixProjectOf(t, map[string]string{"ids.vibe": ids})
	if len(result.Refused) == 0 {
		t.Fatalf("--fix wrote a fix that adds an error after it: %s", fixedText(result, "ids.vibe"))
	}
}

// RC-17: one existing error cannot cover both a changed message at its old
// span and its old message at a newly invalid span.
func TestFixGateRefusesMixedMessageSpanMultiplicity(t *testing.T) {
	const helper = "import * as Schema from \"effect/Schema\"\n" +
		"const makeId = () => Schema.String\n" +
		"export const Id = makeId()\n"
	for _, calls := range []bool{false, true} {
		t.Run(fmt.Sprintf("calls=%v", calls), func(t *testing.T) {
			user := "import { Effect, Schema } from \"effect\"\n" +
				"import { Id } from \"./ids.vibe\"\n"
			if calls {
				user += "declare const other: typeof Id extends Effect.Effect<unknown> ? number : Effect.Effect<typeof Schema.String>\n" +
					"declare function needsNumber(n: number): void\n" +
					"needsNumber(Id)\nneedsNumber(other)\n"
			} else {
				user += "export const count: number = Id\n" +
					"export const other: number = null as unknown as (typeof Id extends Effect.Effect<unknown> ? number : Effect.Effect<typeof Schema.String>)\n"
			}
			result := fixProjectOf(t, map[string]string{"ids.vibe": helper, "user.vibe": user})
			if len(result.Refused) == 0 || strings.Contains(fixedText(result, "ids.vibe"), "const makeId = (): ") {
				t.Fatalf("--fix kept a repair that turns one error into two: refused=%+v, helper=%s", result.Refused, fixedText(result, "ids.vibe"))
			}
		})
	}
}

func gateDiagnostic(file *ast.SourceFile, code int32, pos int, message string) *ast.Diagnostic {
	return ast.NewDiagnosticFromText(file, core.NewTextRange(pos, pos+1), code, diagnostics.CategoryError, message, nil, nil, false, false)
}

func TestAddedCountsOneToOne(t *testing.T) {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/gate.vibe", PathKey: "/gate.vibe"}, strings.Repeat(" ", 64), core.ScriptKindTS)
	a := gateDiagnostic(file, 2322, 1, "A")
	b := gateDiagnostic(file, 2322, 2, "B")
	changed := gateDiagnostic(file, 2322, 1, "B")
	moved := gateDiagnostic(file, 2322, 3, "A")
	tests := []struct {
		name          string
		before, after []*ast.Diagnostic
		added         int
	}{
		{"mixed message and span", []*ast.Diagnostic{a}, []*ast.Diagnostic{changed, moved}, 1},
		{"mixed reversed", []*ast.Diagnostic{a}, []*ast.Diagnostic{moved, changed}, 1},
		{"duplicate current", []*ast.Diagnostic{a}, []*ast.Diagnostic{a, a}, 1},
		{"duplicate baseline", []*ast.Diagnostic{a, a}, []*ast.Diagnostic{changed, moved}, 0},
		{"duplicate baseline exhausted", []*ast.Diagnostic{a, a}, []*ast.Diagnostic{changed, moved, moved}, 1},
		{"reassign message match", []*ast.Diagnostic{a, b}, []*ast.Diagnostic{changed, moved}, 0},
		{"reassign span match", []*ast.Diagnostic{b, a}, []*ast.Diagnostic{changed, gateDiagnostic(file, 2322, 2, "C")}, 0},
		{"changed message", []*ast.Diagnostic{a}, []*ast.Diagnostic{changed}, 0},
		{"moved span", []*ast.Diagnostic{a}, []*ast.Diagnostic{moved}, 0},
		{"new code", []*ast.Diagnostic{a}, []*ast.Diagnostic{gateDiagnostic(file, 2345, 1, "A")}, 1},
		{"no span", []*ast.Diagnostic{gateDiagnostic(nil, 2322, 1, "A")}, []*ast.Diagnostic{gateDiagnostic(nil, 2322, 1, "B")}, 1},
		{"no file duplicate", []*ast.Diagnostic{gateDiagnostic(nil, 2322, 1, "A")}, []*ast.Diagnostic{gateDiagnostic(nil, 2322, 2, "A"), gateDiagnostic(nil, 2322, 3, "A")}, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseline := countErrors(tt.before, errorSpanKey)
			got := addedCounts(tt.after, baseline)
			n := 0
			for _, count := range got {
				n += count
			}
			if n != tt.added {
				t.Fatalf("added=%v (%d), want %d", got, n, tt.added)
			}
		})
	}
}

func TestAddedCountsTranslatedSpans(t *testing.T) {
	before := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/gate.vibe", PathKey: "/gate.vibe"}, "head old tail", core.ScriptKindTS)
	after := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/gate.vibe", PathKey: "/gate.vibe"}, "head longer tail", core.ScriptKindTS)
	old := []*ast.Diagnostic{gateDiagnostic(before, 2322, 10, "A")}
	baseline := countErrors(old, errorSpanKey)
	baseline.texts = map[string]string{"/gate.vibe": before.Text()}
	for _, tt := range []struct {
		name string
		now  []*ast.Diagnostic
		want int
	}{
		{"translated changed message", []*ast.Diagnostic{gateDiagnostic(after, 2322, 13, "B")}, 0},
		{"translated mixed", []*ast.Diagnostic{gateDiagnostic(after, 2322, 13, "B"), gateDiagnostic(after, 2322, 0, "A")}, 1},
		{"edited interior", []*ast.Diagnostic{gateDiagnostic(after, 2322, 6, "B")}, 1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			n := 0
			for _, count := range addedCounts(tt.now, baseline) {
				n += count
			}
			if n != tt.want {
				t.Fatalf("added=%d, want %d", n, tt.want)
			}
		})
	}
}

// Exhaustively try every partial injection, independently of the production
// matching algorithm. Each baseline occurrence may discharge one current
// occurrence by file/code/message or by file/code/span.
func bruteGateMatches(before, after []*ast.Diagnostic, index int, used uint64) int {
	if index == len(after) {
		return 0
	}
	best := bruteGateMatches(before, after, index+1, used)
	d := after[index]
	for i, old := range before {
		if used&(1<<i) != 0 {
			continue
		}
		sameFile := d.File() == nil && old.File() == nil
		if d.File() != nil && old.File() != nil {
			sameFile = d.File().FileName() == old.File().FileName()
		}
		if !sameFile || errorCode(d) != errorCode(old) {
			continue
		}
		if d.String() != old.String() && (d.File() == nil || d.Pos() != old.Pos() || d.Len() != old.Len()) {
			continue
		}
		best = max(best, 1+bruteGateMatches(before, after, index+1, used|(1<<i)))
	}
	return best
}

func checkGateMultisets(t *testing.T, data []byte) {
	t.Helper()
	if len(data) < 2 {
		return
	}
	files := []*ast.SourceFile{nil}
	for _, name := range []tspath.RootedFilePath{"/a.vibe", "/b.vibe"} {
		files = append(files, parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name}, strings.Repeat(" ", 64), core.ScriptKindTS))
	}
	next := 2
	makeErrors := func(n int) []*ast.Diagnostic {
		var result []*ast.Diagnostic
		for range n {
			var x, y byte
			if next < len(data) {
				x = data[next]
				next++
			}
			if next < len(data) {
				y = data[next]
				next++
			}
			d := gateDiagnostic(files[int(x)%len(files)], 2322+int32((x/3)%2)*23, int(y%4), string(rune('A'+(y/4)%3)))
			result = append(result, d)
		}
		return result
	}
	before, after := makeErrors(int(data[0]%7)), makeErrors(int(data[1]%7))
	want := len(after) - bruteGateMatches(before, after, 0, 0)
	baseline := countErrors(before, errorSpanKey)
	for range 2 {
		got := addedCounts(after, baseline)
		total := 0
		for key, count := range got {
			if count <= 0 {
				t.Fatalf("nonpositive added count %q: %d", key, count)
			}
			total += count
		}
		if total != want {
			t.Fatalf("data=%x: added=%v (%d), oracle=%d", data, got, total, want)
		}
		// Matching size cannot depend on input order, and a check must not
		// consume the baseline used by subsequent trials.
		for i, j := 0, len(after)-1; i < j; i, j = i+1, j-1 {
			after[i], after[j] = after[j], after[i]
		}
	}
}

func TestAddedCountsRandomMultisets(t *testing.T) {
	rng := rand.New(rand.NewPCG(17, 49))
	for range 3000 {
		data := make([]byte, 26)
		for i := range data {
			data[i] = byte(rng.Uint32())
		}
		checkGateMultisets(t, data)
	}
}

func FuzzAddedCountsOneToOne(f *testing.F) {
	f.Add([]byte{1, 2, 1, 0, 1, 4, 1, 2})
	f.Add([]byte{2, 2, 1, 0, 1, 5, 1, 4, 1, 2})
	f.Add([]byte{1, 2, 0, 0, 0, 0, 0, 0})
	f.Fuzz(func(t *testing.T, data []byte) { checkGateMultisets(t, data) })
}
