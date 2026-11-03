package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFixNothrowCalls(t *testing.T) {
	for _, source := range []string{
		"export function f(input:{id?:string|null}):bigint{return input.id==null?0n:BigInt(input.id)}",
		"export function f(s:string):unknown { return JSON.parse(s) }",
		"export function f(n=JSON.parse(\"1\")):unknown {return n}",
		"export function f(s:string):unknown {return s ? JSON.parse(s) : JSON.parse(\"null\")}",
		"import {Box} from \"./native.js\";export function f(n:number):Box {return new Box(n)}",
	} {
		source = strings.ReplaceAll(source, "\\n", "\n")
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			writeNothrowNativeFixture(t, filepath.Dir(file.FileName().AsString()))
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, "$invoke(") || len(result.Sites) != 0 {
				t.Fatalf("missing preserving call: %+v", result)
			}
			if strings.Count(fixed.Text, "export function invoke<") != 1 {
				t.Fatalf("must reuse one invocation module: %s", fixed.Text)
			}
		})
	}
}

func TestFixNothrowInternalEffectFactory(t *testing.T) {
	source := "export effect function outer(n:number) { function task():number!! {if(n) throw /*keep*/ n;return Effect.succeed(n)};return try task()}"
	_, file, _, _ := editorProgram(t, source)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || !strings.Contains(fixed.Text, "return die(") || len(result.Sites) != 0 {
		t.Fatalf("immediately-run internal factory not repaired: %+v", result)
	}
	if !strings.Contains(fixed.Text, "/*keep*/") {
		t.Fatalf("throw comment lost: %s", fixed.Text)
	}
	for _, unsafe := range []string{
		"export effect function outer(xs:Iterable<number>){function task():number!! {for(const n of xs){throw n};return Effect.succeed(0)};return try task()}",

		"export function task(n:number):number!! {if(n)throw n;return Effect.succeed(n)}",
		"function task(n:number):number!! {if(n)throw n;return Effect.succeed(n)};export const escaped={task}",
		"function task(n:number):number!! {if(n)throw n;return Effect.succeed(n)};export effect function outer(){const p=task(1);Console.log(\"after\");return try p}",
	} {
		_, f, _, _ := editorProgram(t, unsafe)
		r := fixCase(t, filepath.Dir(f.FileName().AsString()))
		for _, x := range r.Files {
			if strings.Contains(x.Text, "return die(") {
				t.Fatalf("escaped/call-time behavior changed: %s", x.Text)
			}
		}
		if len(r.Sites) == 0 {
			t.Fatalf("missing per-site refusal: %+v", r)
		}
	}
}

func TestFixNothrowCallsRefuseUnprovedTypes(t *testing.T) {
	for _, source := range []string{
		"export function main(s:string):unknown{return JSON /*keep*/.parse(s)}",
		"import {predicate} from \"./native.js\";export const main=(n:unknown):infer _=>predicate(n)",
		"import {generic} from \"./native.js\";export const main=(n:number):infer _=>generic(n)",
		"import {spread} from \"./native.js\";export const main=(n:number[]):infer _=>spread(...n)",
		"import {overloaded} from \"./native.js\";export const main=(n:number):infer _=>overloaded(n)",
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			writeNothrowNativeFixture(t, filepath.Dir(file.FileName().AsString()))
			r := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			if len(r.Sites) == 0 {
				t.Fatalf("missing refusal: %+v", r)
			}
			for _, fixed := range r.Files {
				if strings.Contains(fixed.Text, "$invoke(") {
					t.Fatalf("unproved type change: %s", fixed.Text)
				}
			}
		})
	}
}

func writeNothrowNativeFixture(t *testing.T, dir string) {
	t.Helper()
	source := `export class Box {
 /** @throws {Error} */
 constructor(readonly n:number){if(n)throw new Error(String(n))}
}
/** @throws {Error} */
export function predicate(n:unknown):n is string {return typeof n==="string"}
/** @throws {Error} */
export function generic<T>(n:T):T{return n}
/** @throws {Error} */
export function spread(...n:number[]):number{return n.length}
/** @throws {Error} */
export function overloaded(n:number):number;
/** @throws {Error} */
export function overloaded(n:string):string;
export function overloaded(n:number|string):number|string{return n}
`
	if err := os.WriteFile(filepath.Join(dir, "native.ts"), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
}
