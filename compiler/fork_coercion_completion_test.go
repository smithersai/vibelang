package compiler

import "testing"

// Failures §Authorability requires every Result to be consumed, and
// Requirements §Scoping requires ownership of every started Promise. Native
// ToPrimitive is not an owner of either channel: its implicit call discards an
// object completion. Use the compiler's actual protocol walk, including getters,
// aliases, member order and exotic-to-primitive short-circuiting.
func TestPinnedForkCoercionCompletionOwnership(t *testing.T) {
	for _, tc := range []struct {
		name, setup, value, code string
	}{
		{"method Result", `const obj={valueOf():Result<number,Boom>{return 1}}`, `+obj`, "VIBE1303"},
		{"inferred Result", `const obj={valueOf(){throw new Boom()}}`, `+obj`, "VIBE1303"},
		{"Result field", `const obj={valueOf:():Result<number,Boom>=>1}`, `+obj`, "VIBE1303"},
		{"Result alias", `const read=():Result<number,Boom>=>1;const obj={valueOf:read}`, `+obj`, "VIBE1303"},
		{"class Result", `class Box{valueOf():Result<number,Boom>{return 1}};const obj=new Box()`, `+obj`, "VIBE1303"},
		{"getter returns method", `const obj={get valueOf(){return ():Result<number,Boom>=>1}}`, `+obj`, "VIBE1303"},
		{"getter discards Result", `const obj={get valueOf():Result<number,Boom>{return 1}}`, `+obj`, "VIBE1303"},
		{"toString Result", `const obj={toString():Result<string,Boom>{return "1"}}`, "`${obj}`", "VIBE1303"},
		{"exotic Result", `const obj={[Symbol.toPrimitive]():Result<number,Boom>{return 1}}`, `+obj`, "VIBE1303"},
		{"Number Result", `const obj={valueOf():Result<number,Boom>{return 1}}`, `Number(obj)`, "VIBE1303"},
		{"Math Result", `const obj={valueOf():Result<number,Boom>{return 1}}`, `Math.abs(obj as unknown as number)`, "VIBE1303"},
		{"coercion cast", `const obj={valueOf():Result<number,Boom>{return 1}}`, `+(obj as unknown as number)`, "VIBE1303"},
		{"Result container", `function make():Result<number,Boom>{return 1};const obj={valueOf(){return {answer:make()}}}`, `+obj`, "VIBE1303"},
		{"async method", `const obj={async valueOf():Promise<number>{return 1}}`, `+obj`, "VIBE1404"},
		{"Promise return", `const obj={valueOf():Promise<number>{return Promise.resolve(1)}}`, `+obj`, "VIBE1404"},
		{"Promise field", `const obj={valueOf:async()=>1}`, `+obj`, "VIBE1404"},
		{"exotic Promise", `const obj={async [Symbol.toPrimitive]():Promise<number>{return 1}}`, `+obj`, "VIBE1404"},
		{"Promise container", `const obj={valueOf(){return [Promise.resolve(1)]}}`, `+obj`, "VIBE1404"},
		{"JSON Number wrapper", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj=new Box(1)`, `JSON.stringify(obj)`, "VIBE1303"},
		{"JSON String wrapper", `class Box extends String{[Symbol.toPrimitive]():Result<string,Boom>{return "1"}};const obj=new Box("1")`, `JSON.stringify(obj)`, "VIBE1303"},
		{"JSON returned wrapper", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj={toJSON(){return new Box(1)}}`, `JSON.stringify(obj)`, "VIBE1303"},
		{"JSON replacer wrapper", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj={plain:1}`, `JSON.stringify(obj,()=>new Box(1))`, "VIBE1303"},
		{"JSON identity replacer", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj=new Box(1)`, `JSON.stringify(obj,(_key,value)=>value)`, "VIBE1303"},
		{"JSON optional toJSON", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj:{toJSON?:()=>Box}={toJSON:()=>new Box(1)}`, `JSON.stringify(obj)`, "VIBE1303"},
		{"JSON union toJSON", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj=true?{toJSON(){return new Box(1)}}:{plain:1}`, `JSON.stringify(obj)`, "VIBE1303"},
		{"JSON optional replacer", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj=1;const replacer=true?()=>new Box(1):undefined`, `JSON.stringify(obj,replacer)`, "VIBE1303"},
		{"JSON absent replacer retains wrapper", `class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};const obj=new Box(1);const replacer=true?undefined:()=>2`, `JSON.stringify(obj,replacer)`, "VIBE1303"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: `class Boom extends Error{};` + tc.setup + `;export function main(){return ` + tc.value + `}`}})
			requireDiagnostic(t, result, tc.code, "main.vibe", "coercion protocol")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatalf("implicit completion escaped ownership: %+v", result)
			}
		})
	}
}

func TestPinnedForkCoercionCompletionPreservesOrdinaryConsumers(t *testing.T) {
	for _, source := range []string{
		`const obj={valueOf():Result<number,Boom>{return 1}};export function main(){return obj.valueOf().match({ok:v=>v,error:e=>0})}`,
		"const obj={valueOf():Result<number,Boom>{return 1}};export function main(){return `${obj}`}",
		`const obj={async valueOf():Promise<number>{return 1}};export async function main(){return +(await obj.valueOf())}`,
		`const obj={async valueOf(){return 1}};export function main(){return String(obj)}`,
		`const obj={valueOf():Result<number,Boom>{return 1},[Symbol.toPrimitive](){return 2}};export function main(){return +obj}`,
		`const obj={toString():Result<string,Boom>{return "1"},valueOf(){return 2}};export function main(){return +obj}`,
		`const obj={valueOf(){return {plain:1}},toString(){return "2"}};export function main(){return +obj}`,
		`const obj={valueOf():Result<number,Boom>{return 1}};export function main(){return obj.valueOf}`,
		`const obj={toString():Result<string,Boom>{return "unused"}};export function main(){return JSON.stringify(obj)}`,
		`const obj={async toString(){return "unused"}};export function main(){return JSON.stringify(obj)}`,
		`class Number{toString():Result<string,Boom>{return "unused"}};export function main(){return JSON.stringify(new Number())}`,
		`class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1};toJSON(){return 2}};export function main(){return JSON.stringify(new Box(1))}`,
		`class Box extends Number{[Symbol.toPrimitive]():Result<number,Boom>{return 1}};export function main(){return JSON.stringify(new Box(1),()=>2)}`,
		`class Box extends Number{};const obj=true?new Box(1):{valueOf():Result<number,Boom>{return 1}};export function main(){return JSON.stringify(obj)}`,
		`class Box extends String{};const obj=true?new Box("1"):{toString():Result<string,Boom>{return "1"}};export function main(){return JSON.stringify(obj)}`,
	} {
		t.Run(source, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: `class Boom extends Error{};` + source}})
			requireClean(t, result)
		})
	}
}

func TestPinnedForkJSONCoercionWrapperRowsMatchExecution(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const prelude = `import {Context} from "vibelang/context";import {Layer} from "vibelang/provider";
abstract class Db extends Context{abstract read():number};`
	for _, tc := range []struct {
		name, setup, expression, stdout string
		requiresDb                      bool
	}{
		{"ordinary object", `const obj={toString(){return String(Db.context().read())}}`, `JSON.stringify(obj)`, `{}`, false},
		{"Number wrapper", `class Box extends Number{valueOf(){return Db.context().read()}};const obj=new Box(1)`, `JSON.stringify(obj)`, `42`, true},
		{"String wrapper", `class Box extends String{toString(){return String(Db.context().read())}};const obj=new Box("1")`, `JSON.stringify(obj)`, `"42"`, true},
		{"Boolean internal slot", `class Box extends Boolean{valueOf(){return Db.context().read()>0};toString(){return String(Db.context().read())}};const obj=new Box(true)`, `JSON.stringify(obj)`, `true`, false},
		{"toJSON replaces wrapper", `class Box extends Number{valueOf(){return Db.context().read()};toJSON(){return 2}};const obj=new Box(1)`, `JSON.stringify(obj)`, `2`, false},
		{"toJSON returns wrapper", `class Box extends Number{valueOf(){return Db.context().read()}};const obj={toJSON(){return new Box(1)}}`, `JSON.stringify(obj)`, `42`, true},
		{"replacer removes wrapper", `class Box extends Number{valueOf(){return Db.context().read()}};const obj=new Box(1)`, `JSON.stringify(obj,()=>2)`, `2`, false},
		{"identity replacer", `class Box extends Number{valueOf(){return Db.context().read()}};const obj=new Box(1)`, `JSON.stringify(obj,(_key,value)=>value)`, `42`, true},
		{"replacer produces wrapper", `class Box extends Number{valueOf(){return Db.context().read()}};const obj=1`, `JSON.stringify(obj,()=>new Box(1))`, `42`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: prelude + tc.setup + `;export const answer=` + tc.expression + `;export function main(){return answer}`}}
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: files, Lowering: LoweringInternal})
			if err != nil {
				t.Fatal(err)
			}
			if tc.requiresDb {
				requireDiagnostic(t, result, "VIBE2102", "main.vibe", "Db")
				if !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatal("JSON conversion dropped its capability")
				}
				files[0].Text = prelude + tc.setup + `;export function main(){return Layer.provide(Layer.succeed(Db,{read:()=>42}),()=>` + tc.expression + `)}`
				result, err = backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: files, Lowering: LoweringInternal})
				if err != nil {
					t.Fatal(err)
				}
			}
			requireClean(t, result)
			if actual := runPublishedConsumer(t, CompileResult{}, result); actual != tc.stdout {
				t.Fatalf("JSON conversion computed %q, expected %q", actual, tc.stdout)
			}
		})
	}
}
