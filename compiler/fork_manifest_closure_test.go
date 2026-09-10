package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

// Executable bodies need a transitive effect set even when their ordinary
// control flow cannot be expressed by the historical static Plan. These tests
// observe the published descriptor, never infer a Manifest from a Plan.
func TestPinnedForkManifestClosure(t *testing.T) {
	for _, tc := range []struct{ name, declarations, body string }{
		{"unrelated context method", `const api = { context(n: number): Result<number, never> { return Read.run(n)! } };`, `api.context(n)`},
		{"ordinary helper", `function helper(n: number): Result<number, never> { return Read.run(n)! }`, `helper(n)`},
		{"helper alias", `function helper(n: number): Result<number, never> { return Read.run(n)! }; const alias=helper;`, `alias(n)`},
		{"recursive helper", `function helper(n: number): Result<number, never> { return n>0 ? Read.run(n)!+helper(n-1)! : 0 }`, `helper(n)`},
		{"overloaded helper", `function helper(n: number): Result<number, never>; function helper(n: number): Result<number, never> { return Read.run(n)! }`, `helper(n)`},
		{"callback value", `function step(n: number): Result<number, never> { return Read.run(n)! }; function helper(n: number): Result<number, never> { return Result.all([n].map(step))!.length }`, `helper(n)`},
		{"overloaded callback", `function step(n: number): Result<number, never>; function step(n: number): Result<number, never> { return Read.run(n)! }; function helper(n: number): Result<number, never> { return Result.all([n].map(step))!.length }`, `helper(n)`},
		{"getter", `const box={get value():Result<number,never>{return Read.run(1)!}}; function helper(n:number):Result<number,never>{return box.value}`, `helper(n)`},
		{"constructor", `class Box { value:number; constructor(n:number){this.value=Read.run(n).unwrapOr(0)} }; function helper(n:number){return new Box(n).value}`, `helper(n)`},
		{"inherited constructor", `class Base { value:number; constructor(n:number){this.value=Read.run(n).unwrapOr(0)} }; class Box extends Base {}; function helper(n:number){return new Box(n).value}`, `helper(n)`},
		{"field initializer", `class Box { value=Read.run(1).unwrapOr(0); constructor(){} }; function helper(n:number){return new Box().value}`, `helper(n)`},
		{"inherited field initializer", `class Base {constructor(){}}; class Box extends Base {value=Read.run(1).unwrapOr(0)}; function helper(n:number){return new Box().value}`, `helper(n)`},
		{"default constructor initializer", `class Box {value=Read.run(1).unwrapOr(0)}; function helper(n:number){return new Box().value}`, `helper(n)`},
		{"base field initializer", `class Base {value=Read.run(1).unwrapOr(0)}; class Box extends Base {}; function helper(n:number){return new Box().value}`, `helper(n)`},
		{"private field initializer", `class Box {#value=Read.run(1).unwrapOr(0); get value(){return this.#value}}; function helper(n:number){return new Box().value}`, `helper(n)`},
		{"aliased class initializer", `class Box {value=Read.run(1).unwrapOr(0)}; const Alias=Box; function helper(n:number){return new Alias().value}`, `helper(n)`},
		{"class expression initializer", `const Box=class {value=Read.run(1).unwrapOr(0)}; function helper(n:number){return new Box().value}`, `helper(n)`},
		{"tagged template", "function tag(parts:TemplateStringsArray):Result<number,never>{return Read.run(parts.length)!}; function helper(n:number):Result<number,never>{return tag`x`}", `helper(n)`},
		{"coercion", `const box={valueOf(){return Read.run(1).unwrapOr(0)}}; function helper(n:number){return +box}`, `helper(n)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {durable,Action} from "vibelang:flows";
class Read extends Action<(n:number)=>Result<number,never>> {}
` + tc.declarations + `
export const Flow=durable((n:number):Result<number,never>=>{return ` + tc.body + `});
export function main(){return JSON.stringify(Flow.manifest)}`
			result := compileComptime(t, comptimeSources(source), nil)
			if result.EmitSkipped {
				t.Fatalf("refused a resolvable closure: %+v", result.Diagnostics)
			}
			wire := runComptimeProgram(t, result)
			var manifest forkManifest
			if err := json.Unmarshal([]byte(wire), &manifest); err != nil {
				t.Fatalf("manifest=%s error=%v", wire, err)
			}
			if len(manifest.Actions) != 1 || manifest.Actions[0].ID != "main.vibe#Read" || len(manifest.Requirements) != 1 || manifest.Requirements[0] != "main.vibe#Read" || len(manifest.Sites) != 1 || manifest.Sites[0].Kind != "perform" {
				t.Fatalf("lost or duplicated helper effect: %s", wire)
			}
		})
	}
}

func TestPinnedForkManifestConstructionClosure(t *testing.T) {
	for _, tc := range []struct {
		name, declarations string
		sites              int
	}{
		{"base and derived fields and constructor", `class Base {base=Read.run(1).unwrapOr(0)}; class Box extends Base {value=Read.run(2).unwrapOr(0); constructor(){super();this.value+=Read.run(3).unwrapOr(0)}}`, 3},
		{"static initialization is not construction", `class Box {static value=false ? Read.run(1).unwrapOr(0) : 0; value=0}`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(`import {durable,Action} from "vibelang:flows";
class Read extends Action<(n:number)=>Result<number,never>> {}
`+tc.declarations+`
function helper(n:number){return new Box().value}
export const Flow=durable((n:number)=>{return helper(n)});
export function main(){return JSON.stringify(Flow.manifest)}`), nil)
			requireClean(t, result)
			wire := runComptimeProgram(t, result)
			var manifest forkManifest
			if err := json.Unmarshal([]byte(wire), &manifest); err != nil {
				t.Fatal(err)
			}
			if len(manifest.Sites) != tc.sites {
				t.Fatalf("construction sites=%s", wire)
			}
		})
	}
}

func TestPinnedForkManifestDynamicConstructionRefuses(t *testing.T) {
	for _, declaration := range []string{
		`const Box=true ? Plain : Effectful`,
		`let Box=Plain; Box=Effectful`,
		`class Box {value=0}; Box=Effectful`,
		`const opaque:typeof Plain=undefined as unknown as typeof Plain; const Box=opaque`,
		`let Base=Plain; Base=Effectful; class Box extends Base {}`,
	} {
		t.Run(declaration, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(`import {durable,Action} from "vibelang:flows";
class Read extends Action<(n:number)=>Result<number,never>> {}
class Plain {value=0;constructor(){}}
class Effectful {value=Read.run(1).unwrapOr(0);constructor(){}}
`+declaration+`;
function helper(n:number){return new Box().value}
export const Flow=durable((n:number)=>{return helper(n)});`), nil)
			if !result.EmitSkipped {
				t.Fatal("constructor type erased an initialization effect")
			}
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Code == "VIBE4110" && strings.Contains(diagnostic.Message, "Effect Manifest cannot state") {
					return
				}
			}
			t.Fatalf("missing closed construction refusal: %+v", result.Diagnostics)
		})
	}
}

func TestPinnedForkManifestCapabilityClosure(t *testing.T) {
	for _, tc := range []struct {
		name, declarations, body string
	}{
		{"direct", "", `Db.context().value+n`},
		{"computed", "", `Db["context"]().value+n`},
		{"alias", `const Alias=Db;`, `Alias.context().value+n`},
		{"helper", `function read(n:number){return Db.context().value+n}`, `read(n)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {durable} from "vibelang:flows";
import {Context} from "vibelang/context";
import {Layer} from "vibelang/provider";
class Db extends Context {value:number=1}
` + tc.declarations + `
export const Flow=durable((n:number)=>{return Layer.provide(Layer.succeed(Db, {value:2}), ()=>` + tc.body + `)});
export function main(){return JSON.stringify(Flow.manifest)}`
			result := compileComptime(t, comptimeSources(source), nil)
			requireClean(t, result)
			wire := runComptimeProgram(t, result)
			var manifest forkManifest
			if err := json.Unmarshal([]byte(wire), &manifest); err != nil {
				t.Fatal(err)
			}
			if len(manifest.Sites) != 1 || manifest.Sites[0].Kind != "get" || manifest.Sites[0].Key != "main.vibe#Db" {
				t.Fatalf("capability site lost: %s", wire)
			}
			if len(manifest.Requirements) != 0 {
				t.Fatalf("requirement/discharge mismatch: %s", wire)
			}
		})
	}
}

func TestPinnedForkManifestExternalCapabilityStillRefuses(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import {durable} from "vibelang:flows";
import {Context} from "vibelang/context";
class Db extends Context {value:number=1}
export const Flow=durable((n:number)=>{return Db.context().value+n});`), nil)
	if !result.EmitSkipped {
		t.Fatal("external capability support was silently widened")
	}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == "VIBE1808" {
			return
		}
	}
	t.Fatalf("missing requirement-row refusal: %+v", result.Diagnostics)
}

func TestPinnedForkManifestMutableClosureRefuses(t *testing.T) {
	for _, expression := range []string{`callback(n)`, `Result.all([n].map(callback))!.length`} {
		t.Run(expression, func(t *testing.T) {
			result := compileComptime(t, comptimeSources(`import {durable,Action} from "vibelang:flows";
class Read extends Action<(n:number)=>Result<number,never>> {}
function first(n:number):Result<number,never>{return n}
function second(n:number):Result<number,never>{return Read.run(n)!}
let callback=first;callback=second;
function helper(n:number):Result<number,never>{return `+expression+`}
export const Flow=durable((n:number):Result<number,never>=>{return helper(n)});`), nil)
			if !result.EmitSkipped {
				t.Fatal("mutable binding narrowed the manifest to its initializer")
			}
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Code == "VIBE4110" && strings.Contains(diagnostic.Message, "Effect Manifest cannot state") {
					return
				}
			}
			t.Fatalf("missing closed manifest refusal: %+v", result.Diagnostics)
		})
	}
}

func TestPinnedForkManifestUnresolvedContextIsRefused(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import {durable} from "vibelang:flows";
declare const opaque:{context(n:number):number};
export const Flow=durable((n:number)=>{return opaque.context(n)});`), nil)
	if !result.EmitSkipped {
		t.Fatal("opaque context method published a partial manifest")
	}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == "VIBE4110" && strings.Contains(diagnostic.Message, "Effect Manifest cannot state") {
			return
		}
	}
	t.Fatalf("missing closed manifest refusal: %+v", result.Diagnostics)
}
