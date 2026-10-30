package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 6: "Exported schema and data declarations emit the TypeScript
// declarations of their Effect TypeScript counterparts above" (the live
// backtick-marked sentence is checked through dataRules).
// Check exported types in a consumer of only the emitted .d.ts, never the
// .vibe source. The reference is independently written from chapter 6.
type dataDeclarationWitness struct {
	name, vibe, reference, instance string
}

func dataDeclarationWitnesses() []dataDeclarationWitness {
	out := []dataDeclarationWitness{
		{"schema",
			"export schema S { readonly id:string; n:number; xs:number[]; readonly frozen:readonly number[]; opt?:string }",
			`import { Schema } from "effect"; export const S = Schema.Struct({id:Schema.String,n:Schema.mutableKey(Schema.Number),xs:Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Number))),frozen:Schema.Array(Schema.Number),opt:Schema.mutableKey(Schema.optional(Schema.String))}); export type S = typeof S.Type`,
			"S"},
		{"data",
			"export data S { Empty; Full { n:number; x?:string } }",
			`import { Data } from "effect"; export type S = Data.TaggedEnum<{Empty:{};Full:{n:number;x?:string}}>; export const S = Data.taggedEnum<S>()`,
			"S"},
	}
	for n := 1; n <= 4; n++ {
		params := []string{"First", "Second", "Third", "Fourth"}[:n]
		args := []string{"string", "number", "boolean", "bigint"}[:n]
		var fields, slots []string
		for i, param := range params {
			fields = append(fields, fmt.Sprintf("f%d:%s", i, param))
			slots = append(slots, fmt.Sprintf("this[%q]", string(rune('A'+i))))
		}
		parameters, payload := strings.Join(params, ","), strings.Join(fields, ";")
		out = append(out, dataDeclarationWitness{
			fmt.Sprintf("generic-%d", n),
			"export data S<" + parameters + "> { V {" + payload + "} }",
			fmt.Sprintf(`import { Data } from "effect"; export type S<%s> = Data.TaggedEnum<{V:{%s}}>; interface ReferenceDefinition extends Data.TaggedEnum.WithGenerics<%d> { readonly taggedEnum:S<%s> }; export const S = Data.taggedEnum<ReferenceDefinition>()`, parameters, payload, n, strings.Join(slots, ",")),
			"S<" + strings.Join(args, ",") + ">",
		})
	}
	return out
}

func dataDeclarationRules() []dataRule {
	var out []dataRule
	for _, w := range dataDeclarationWitnesses() {
		out = append(out, dataRule{
			name: "declaration-" + w.name, chapter: "006-data.md",
			quote:  "Exported `schema` and `data` declarations emit the TypeScript declarations of their Effect TypeScript counterparts above",
			source: w.vibe, owner: "vip-decls",
		})
	}
	return out
}

func dataDeclarationDiagnostics(t *testing.T, w *Workspace, c dataRule, emitted *Result) []*ast.Diagnostic {
	t.Helper()
	var witness *dataDeclarationWitness
	for _, item := range dataDeclarationWitnesses() {
		if c.name == "declaration-"+item.name {
			witness = &item
			break
		}
	}
	if witness == nil {
		return nil
	}
	for _, d := range emitted.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			return nil // The ordinary acceptance oracle reports it.
		}
	}
	control, err := w.Compile(t.Context(), Project{Files: map[string]string{"reference.ts": witness.reference}})
	if err != nil {
		t.Fatal(err)
	}
	defer control.Remove()
	for _, d := range control.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("invalid chapter TypeScript reference for %s: %s", c.name, specDiagnosticText(d))
		}
	}
	text, ok := emitted.Outputs["out/main.d.ts"]
	if !ok {
		Gap(t, dataRuleTarget, "feature:"+c.name, "chapter 6 requires an exported declaration; missing out/main.d.ts\n%s", Archive(emitted.Sources))
		return nil
	}
	// Generic-function equality distinguishes readonly and optional properties,
	// which bidirectional assignment alone does not do in TypeScript.
	instance := witness.instance
	referenceInstance := strings.Replace(instance, "S", "R", 1)
	consumer := `import { S } from "./out/main.js";
import { S as R } from "./reference.js";
type Exact<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2) ? true : false;
const instanceContract: Exact<` + instance + "," + referenceInstance + `> = true;
const constructorContract: Exact<typeof S,typeof R> = true;
const readonlyControl: Exact<{x:number},{readonly x:number}> = false;
export {};
`
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{
		"out/main.d.ts": text,
		"reference.ts":  witness.reference,
		"consumer.ts":   consumer,
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	return r.Diagnostics
}
