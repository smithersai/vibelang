package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestSyncBuiltinCallBridgeQuoted(t *testing.T) {
	const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatal("preserving repair rule moved")
	}
}

func FuzzSyncBuiltinCallBridge(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"direct", "property", "unicode", "collision"} {
		for input := uint8(0); input < 6; input++ {
			f.Add(key, input)
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, input uint8) {
		TestSyncBuiltinCallBridgeQuoted(t)
		const target = "FuzzSyncBuiltinCallBridge"
		name, arg, typ := "s", "s", "string"
		if key == "property" {
			arg = "s.text"
			typ = "{ readonly text: string }"
		}
		if key == "unicode" {
			name, arg = "値", "値"
		}
		source := "import { Effect } from 'effect'\n"
		if key == "collision" {
			source += "const $invoke=0; void $invoke\n"
		}
		source += "export const f = (" + name + ": " + typ + ") => Effect.sync(() => JSON.parse(" + arg + "))\n"
		value := []string{"7", "\"hello\"", "{\"n\":7}", "{", "undefined", ""}[input%6]
		parameter := fmt.Sprintf("%q", value)
		if key == "property" {
			parameter = "{get text(){reads++;return " + parameter + "}}"
		}
		runner := "import {Effect,Exit} from 'effect';import {f} from './main.js'\nexport const main=()=>Effect.sync(()=>{const events:unknown[]=[];let reads=0;const original=JSON.parse;JSON.parse=function(this:typeof JSON,...args:Parameters<typeof JSON.parse>){events.push([this===JSON,args[0]]);return Reflect.apply(original,this,args)};try{const p=f(" + parameter + ");const constructed=[events.length,reads];const inspect=(ex:Exit.Exit<unknown,unknown>)=>Exit.isSuccess(ex)?{tag:ex._tag,value:ex.value}:{tag:ex._tag,reasons:ex.cause.reasons.map(r=>r._tag==='Die'?{tag:r._tag,name:(r.defect as Error).name,message:(r.defect as Error).message}:{tag:r._tag})};return {constructed,exits:[inspect(Effect.runSyncExit(p)),inspect(Effect.runSyncExit(p))],events,reads}}finally{JSON.parse=original}})\n"
		toolsGuard(t, target, func() {
			stock := toolsCompile(t, w, target, map[string]string{"main.ts": source, "runner.ts": runner})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("stock errors: %v", stock.Diagnostics)
			}
			files := map[string]string{"main.vibe": source, "runner.ts": runner}
			before := toolsCompile(t, w, target, files)
			defer before.Remove()
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("repair err=%v refused=%v", result.Err, result.Refused)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				t.Fatalf("fixed errors=%v source=%s", after.Diagnostics, fixed["main.vibe"])
			}
			if mismatch := toolsContractMismatch(t, w, stock, after, false); mismatch != "" {
				t.Fatalf("native API changed: %s", mismatch)
			}
			was, is := node.Run(stock, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
				t.Fatalf("cold native receiver/argument/Exit mismatch stock=%+v fixed=%+v source=%s", was, is, fixed["main.vibe"])
			}
		})
	})
}
