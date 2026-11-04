package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestOptionMatchIgnoredPayload(t *testing.T) {
	for name, source := range map[string]string{
		"contextual-literals": `export const label = (value: Option<number>): "none" | "some" => Option.match(value, { onNone: () => "none", onSome: () => "some" })`,
		"contextual-record":   `export const label = (value: Option<number>): { tag: "none" | "some" } => Option.match(value, { onNone: () => ({tag:"none"}), onSome: () => ({tag:"some"}) })`,
		"contextual-symbol": `export function choose(): string {
 const a = Symbol("tag");
 const result: {tag: typeof a} = Option.match(Option.some(1), { onNone: () => ({tag:a}), onSome: () => ({tag:a}) });
 return result.tag === a ? "tag" : "bad";
}`,
		"contextual-symbol-words": `export const label = (value: Option<number>): "none" | "unique symbol" => Option.match(value, { onNone: () => "none", onSome: () => "unique symbol" })`,
		"opaque-factory-symbol": `function choose(): string {
 function handlers() { const a = Symbol("tag"); return { onNone: (): {tag:typeof a} => ({tag:a}), onSome: (): {tag:typeof a} => ({tag:a}) } }
 const result = Option.match(Option.some(1), handlers());
 return typeof result.tag;
}
export function main() { return Effect.sync(choose) }`,

		"local-symbol-payload-and-helper-shadow": `export function choose():number {
 type ReturnType<T> = never;
 type Parameters<T> = never;
 const $optionResult = Symbol("tag");
 return Option.match(Option.some($optionResult), { onNone: ():number => 0, onSome: ():number => 1 });
}`,

		"local-symbol-getters": `import * as O from "effect/Option"
function choose(): string {
 const a = Symbol("tag");
 function subject(): O.Option<number> { return O.none<number>(); }
 function handlers() { return { get onNone(): () => {tag:typeof a} { return () => ({tag:a}) }, get onSome(): () => {tag:typeof a} { return () => ({tag:a}) } } }
 const result = O.match(subject(), handlers());
 return result.tag === a ? "tag" : "bad";
}
export function main() { return Effect.sync(choose) }`,
		"local-symbol-method": `import { Option as Opt } from "effect"
function choose(): string {
 const value = Symbol("tag");
 function subject(): Opt.Option<number> { return Opt.some(1); }
 function handlers() { return { onNone: (): {tag:typeof value} => ({tag:value}), onSome(): {tag:typeof value} { return {tag:value} } } }
 const result = Opt.match(subject(), handlers());
 return result.tag === value ? "tag" : "bad";
}
export function main() { return Effect.sync(choose) }`,
		"symbol-shadow":     `const a = Symbol("tag"); export const label = (value: Option<number>) => Option.match(value, { onNone: (): {tag: typeof a} => ({tag:a}), onSome: (): {tag: typeof a} => ({tag:a}) })`,
		"symbol-fresh-name": `const $optionValue = Symbol("tag"); export const label = (value: Option<number>) => Option.match(value, { onNone: (): {tag: typeof $optionValue} => ({tag:$optionValue}), onSome: (): {tag: typeof $optionValue} => ({tag:$optionValue}) })`,
		"symbol-getter":     `const a = Symbol("tag"); export const label = (value: Option<number>) => Option.match(value, { onNone: (): {tag: typeof a} => ({tag:a}), get onSome(): () => {tag: typeof a} { return () => ({tag:a}) } })`,
		"empty-rest":        `export const label = (value: Option<number>): number => Option.match(value, { onNone: ():number => 0, onSome: function(...ignored: []):number { return ignored.length } })`,
		"date-payload":      `export const label = (): string => Option.match(DateTime.make("2024-01-02T00:00:00Z"), { onNone: ():string => "none", onSome: ():string => "some" })`,
		"function":          `export const label = (value: Option<number>): number => Option.match(value, { onNone: ():number => 0, onSome: function():number { return 13 } })`,
		"arrow":             `export const label = (value: Option<number>): string => Option.match(value, { onNone: (): string => "none", onSome: (): string => "some" })`,
		"block":             `export const label = (value: Option<number>): string => Option.match(value, { onNone: (): string => "none", onSome: (): string => { return "some" } })`,
		"method":            `export const label = (value: Option<number>): string => Option.match(value, { onNone(): string { return "none" }, onSome(): string { return "some" } })`,
		"getter":            `export const label = (value: Option<number>): string => Option.match(value, { get onNone(): () => string { return () => "none" }, get onSome(): () => string { return () => "some" } })`,
		"bound":             `const handlers = { onNone: (): string => "none", onSome: (): string => "some" }; export const label = (value: Option<number>): string => Option.match(value, handlers)`,
		"alias":             `import { Option as Opt } from "effect"; export const label = (value: Opt.Option<number>): string => Opt.match(value, { onNone: (): string => "none", onSome: (): string => "some" })`,
	} {
		t.Run(name, func(t *testing.T) {
			fixed := applyQuickFix(t, source, EK4839.Code)
			if strings.Contains(fixed, ".match(") {
				t.Fatalf("missing Option match repair: %s", fixed)
			}
			result, name, _ := fixOnce(t, source)
			if result.Err != nil || len(result.Refused) != 0 || result.Files[name] == nil || strings.Contains(result.Files[name].Text, ".match(") {
				t.Errorf("project repair: err %v; refused %+v; files %+v", result.Err, result.Refused, result.Files)
			}
			p, f, _, _ := editorProgram(t, fixed)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s\n%s", d.String(), fixed)
				}
			}
		})
	}
}
