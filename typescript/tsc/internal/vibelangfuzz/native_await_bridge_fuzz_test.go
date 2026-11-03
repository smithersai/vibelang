package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const nativeAwaitBridgeTarget = "FuzzNativeAwaitBridge"
const nativeAwaitBridgeQuote = "In the existing `async` context, suggest `await runPromise(Fiber.join(fiber))` or `await runPromise(Deferred.await(deferred))`"

func nativeAwaitBridgeChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("002-running.md"), nativeAwaitBridgeQuote) {
		t.Fatal("stale async await repair quote")
	}
}
func TestNativeAwaitBridgeQuoted(t *testing.T) { nativeAwaitBridgeChapter(t) }

func nativeAwaitBridgeEdit(t *testing.T, w *Workspace, source, kind string, allowMissing ...bool) string {
	t.Helper()
	r, err := w.Compile(t.Context(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	file := r.SourceFile("main.vibe")
	service, converters := toolsService(w, r.Program, file.FileName())
	code := int32(4609)
	if strings.HasPrefix(kind, "deferred") {
		code = 4610
	}
	for _, diagnostic := range r.Diagnostics {
		if diagnostic.Source() != "EK" || diagnostic.Code() != code {
			continue
		}
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		actions, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		if actions.CommandOrCodeActionArray != nil {
			for _, item := range *actions.CommandOrCodeActionArray {
				a := item.CodeAction
				if a == nil || a.Edit == nil {
					continue
				}
				changes, ok := toolsWorkspaceEdits(a.Edit)
				if !ok {
					t.Fatal("invalid bridge workspace edit")
				}
				fixed, _, err := toolsApply(source, changes[lsconv.FileNameToDocumentURI(file.FileName())])
				if err != nil {
					t.Fatal(err)
				}
				return fixed
			}
		}
		if len(allowMissing) > 0 && allowMissing[0] {
			return ""
		}
		Gap(t, nativeAwaitBridgeTarget, "action:"+kind, "no Promise bridge for %s\n%s", kind, source)
		return ""
	}
	if len(allowMissing) > 0 && allowMissing[0] {
		return ""
	}
	Gap(t, nativeAwaitBridgeTarget, "warning:"+kind, "missing advisory\n%s\n%v", source, Keys(r.Dir, r.Diagnostics))
	return ""
}

// Tooling oracle: applying the spec's bridge keeps async and gives the
// Effect TypeScript twin's Promise success type without new errors.
func FuzzNativeAwaitBridge(f *testing.F) {
	startShortBudget(f)
	nativeAwaitBridgeChapter(f)
	domains := []struct {
		key, typ, parameters, result string
		optional                     bool
	}{
		{"fiber", "Fiber.Fiber<number>", "", "number", false},
		{"deferred", "Deferred.Deferred<number>", "", "number", false},
		{"fiber-generic", "T", "<T extends Fiber.Fiber<number>>", "number", false},
		{"deferred-generic", "T", "<T extends Deferred.Deferred<number>>", "number", false},
		{"fiber-generic-union", "T", "<T extends Fiber.Fiber<number>|Fiber.Fiber<string>>", "number | string", true},
		{"fiber-generic-intersection", "T & {readonly extra?: 1}", "<T extends Fiber.Fiber<number>|Fiber.Fiber<string>>", "number | string", true},
	}
	for _, domain := range domains {
		for i := uint8(0); i < 6; i++ {
			f.Add(domain.key, i)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		nativeAwaitBridgeChapter(t)
		domain := domains[0]
		for _, candidate := range domains {
			if candidate.key == key {
				domain = candidate
				break
			}
		}
		key = domain.key
		operands := []string{"value", "(value)", "box.value", "get()", "/* wait 😀 */ value", "(flag ? value : other)"}
		source := "import type {Fiber, Deferred} from 'effect';\n" +
			"export const probe=async " + domain.parameters + "(value:" + domain.typ + ",other:" + domain.typ + ",box:{value:" + domain.typ + "},get:()=>" + domain.typ + ",flag:boolean," +
			"Effect=0,Fiber=0,Deferred=0,runPromise=0,$awaitRunPromise=0,$awaitJoin=0,$awaitDeferred=0)=>await " + operands[mode%6] + ";\n"
		fixed := nativeAwaitBridgeEdit(t, w, source, domain.key, domain.optional)
		if fixed == "" {
			return
		}
		if strings.Count(fixed, "/* wait 😀 */") != strings.Count(source, "/* wait 😀 */") {
			Gap(t, nativeAwaitBridgeTarget, "comment:"+key, "comment lost\n%s", fixed)
		}
		r, err := w.Compile(t.Context(), Single(fixed+"\nconst completion:Promise<"+domain.result+"> = probe(null!,null!,null!,null!,true);"))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError || d.Source() == "EK" && (d.Code() == 4609 || d.Code() == 4610) {
				Gap(t, nativeAwaitBridgeTarget, fmt.Sprintf("recheck:%s/%d", key, mode%6), "bridge adds diagnostics %v\n%s", Keys(r.Dir, r.Diagnostics), fixed)
				return
			}
		}
		twin := Project{Files: map[string]string{"main.ts": fixed}}
		ref, err := w.Compile(t.Context(), twin)
		if err != nil {
			t.Fatal(err)
		}
		defer ref.Remove()
		if r.Outputs["out/main.d.ts"] != ref.Outputs["out/main.d.ts"] || !strings.Contains(r.Outputs["out/main.d.ts"], "Promise<"+domain.result+">") {
			Gap(t, nativeAwaitBridgeTarget, "declaration:"+key, "bridge differs from Effect TS twin\n%s\n%s", r.Outputs["out/main.d.ts"], ref.Outputs["out/main.d.ts"])
		}
		ExpectPending(t, nativeAwaitBridgeTarget, key)
		ExpectPending(t, nativeAwaitBridgeTarget, specCorpusKey(t))
	})
}

// Execute the actual editor edit, including a getter operand. The reference
// uses the chapter's ordinary Effect TypeScript Promise bridge.
func TestNativeAwaitBridgeRuntime(t *testing.T) {
	nativeAwaitBridgeChapter(t)
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	for _, kind := range []string{"fiber", "deferred"} {
		t.Run(kind, func(t *testing.T) {
			setup := "const value=await E.runPromise(E.forkDetach(E.succeed(7)));"
			bridge := "E.runPromise(F.join(box.value))"
			want := "[7,1]"
			if kind == "deferred" {
				setup = "const value=await E.runPromise(D.make<number>()); await E.runPromise(D.succeed(value,8));"
				bridge = "E.runPromise(D.await(box.value))"
				want = "[8,1]"
			}
			source := "import {Effect as E,Fiber as F,Deferred as D} from 'effect';\n" +
				"export function main(){return E.promise(async()=>{" + setup +
				"let reads=0;const box={get value(){reads++;return value}};" +
				"async function probe(){return await box.value};return [await probe(),reads];})}"
			fixed := nativeAwaitBridgeEdit(t, w, source, kind)
			reference := strings.Replace(source, "await box.value", "await "+bridge, 1)
			for _, project := range []Project{Single(fixed), {Files: map[string]string{"main.ts": reference}}} {
				result, err := w.Compile(t.Context(), project)
				if err != nil {
					t.Fatal(err)
				}
				defer result.Remove()
				for _, d := range result.Diagnostics {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("compile: %v\n%s", Keys(result.Dir, result.Diagnostics), fixed)
					}
				}
				got := node.Run(result, "out/main.js", "main")
				if got.Kind != "success" || string(got.Value) != want {
					t.Fatalf("want %s, got %+v\n%s", want, got, fixed)
				}
			}
		})
	}
}
