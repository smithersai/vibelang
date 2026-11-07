package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlainCatchHandlerKeepsEffectResultRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, key := range []string{"arrow", "block", "function", "parenthesized", "annotated-arrow", "annotated-function", "generic-function", "default-parameter"} {
		t.Run(key, func(t *testing.T) {
			body := `E.sync(()=>{events.push("inner");return 7})`
			handler := `()=>(events.push("handler"),` + body + `)`
			switch key {
			case "block":
				handler = `()=>{events.push("handler");return ` + body + `}`
			case "function":
				handler = `function recover(){events.push("handler");return ` + body + `}`
			case "parenthesized":
				handler = "(" + handler + ")"
			case "annotated-arrow":
				handler = `(): E.Effect<number> =>{events.push("handler");return ` + body + `}`
			case "annotated-function":
				handler = `function recover():E.Effect<number>{events.push("handler");return ` + body + `}`
			case "generic-function":
				handler = `function recover<T extends string>(error:T):E.Effect<number>{events.push(error.length===3?"handler":"wrong");return ` + body + `}`
			case "default-parameter":
				handler = `(error="bad")=>{events.push(error.length===3?"handler":"wrong");return ` + body + `}`
			}
			source := `import {Effect as E} from "effect";export effect function scenario(){const events:string[]=[];const held=E.fail("bad") catch ` + handler + `;events.push("after");const value=try held;return [value,events] as const}`
			js, _, diags := Emit(source, testContext)
			if len(diags) != 0 {
				t.Fatalf("valid plain handler: %v\n%s", diags, js)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(scenario())));`)
			out, err := cmd.CombinedOutput()
			if err != nil || strings.TrimSpace(string(out)) != `[7,["handler","after","inner"]]` {
				t.Fatalf("plain handler must return its Effect unrun: %v; %s\n%s", err, out, js)
			}
		})
	}
}

func TestPlainCatchHandlerReturnedFailureRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	source := `import {Effect as E} from "effect";export effect function scenario(events:string[]){const value=E.fail("first") catch ()=>E.fail("second");events.push("after");return try value}`
	js, _, diags := Emit(source, testContext)
	if len(diags) != 0 {
		t.Fatalf("valid plain handler: %v\n%s", diags, js)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";const events=[];console.log(JSON.stringify(await T.runPromise(T.match(scenario(events),{onFailure:error=>[error,events],onSuccess:value=>[value,events]}))));`)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != `["second",["after"]]` {
		t.Fatalf("returned failure must stay cold until try: %v; %s\n%s", err, out, js)
	}
}

func TestPlainCatchHandlerDataRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	source := `import {Effect as E} from "effect";export effect function scenario(data:any){return (E.fail("bad") catch ()=>data)===data}`
	js, _, diags := Emit(source, testContext)
	if len(diags) != 0 {
		t.Fatalf("valid data fallback: %v\n%s", diags, js)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";const touched=[];const values=[7,{},()=>7,Promise.resolve(7),{then:()=>touched.push("then")},T.sync(()=>touched.push("effect"))];const results=[];for(const value of values)results.push(await T.runPromise(scenario(value)));console.log(JSON.stringify([results,touched]));`)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != `[[true,true,true,true,true,true],[]]` {
		t.Fatalf("plain handler values keep their identity: %v; %s\n%s", err, out, js)
	}
}

func TestEffectCatchHandlerStillRunsWrittenTryRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	source := `import {Effect as E} from "effect";export effect function scenario(){const events:string[]=[];const value=E.fail("bad") catch effect ()=>try E.sync(()=>{events.push("inner");return 7});events.push("after");return [value,events] as const}`
	js, _, diags := Emit(source, testContext)
	if len(diags) != 0 {
		t.Fatalf("valid effect handler: %v\n%s", diags, js)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(scenario())));`)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != `[7,["inner","after"]]` {
		t.Fatalf("effect handler must run its written try: %v; %s\n%s", err, out, js)
	}
}

func TestPlainCatchHandlerCaseRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/catch-plain-returned-effect/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	js, _, diags := Emit(string(source), testContext)
	if len(diags) != 0 {
		t.Fatalf("valid plain handler case: %v\n%s", diags, js)
	}
	scope := mapperTestScope(t, root)
	factory, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/catch-plain-returned-effect/factory.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(scope, "factory.js"), factory, 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(main())));`)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != `[1,2,3,["after arrow","arrow","factory","after function","function","after effect call","effect call"]]` {
		t.Fatalf("plain handler case: %v; %s\n%s", err, out, js)
	}
}

func TestPlainCatchZeroParameterArgumentsRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	source := `import {Effect as E} from "effect";export effect function scenario(){return E.fail("bad") catch function recover(){return [arguments.length,arguments[0],recover.length] as const}}`
	js, _, diags := Emit(source, testContext)
	if len(diags) != 0 {
		t.Fatalf("valid zero-parameter handler: %v\n%s", diags, js)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(scenario())));`)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != `[1,"bad",0]` {
		t.Fatalf("zero-parameter handlers retain their error argument and length: %v; %s\n%s", err, out, js)
	}
}
