package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

var provideAnyCases = []struct{ name, source string }{
	{"any-keyword", "export effect function inspect(provider:any){provide provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-keyword-list", "export effect function inspect(provider:any){provide Layer.empty, provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-direct", "export function inspect(provider:any){return Effect.provide(Effect.succeed(7),provider)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-curried", "export function inspect(provider:any){return Effect.provide(provider)(Effect.succeed(7))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-piped", "export function inspect(provider:any){return Effect.succeed(7).pipe(Effect.provide(provider))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-tuple", "export function inspect(provider:any){return Effect.provide(Effect.succeed(7),[provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-mixed", "export function inspect(provider:any){return Effect.provide(Effect.succeed(7),[Layer.empty,provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-alias", "export function inspect(provider:any){const selected=provider;return Effect.provide(Effect.succeed(7),selected)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-keyword", "export effect function inspect(provider:NoInfer<any>){provide provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-keyword-list", "export effect function inspect(provider:NoInfer<any>){provide Layer.empty, provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-direct", "export function inspect(provider:NoInfer<any>){return Effect.provide(Effect.succeed(7),provider)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-curried", "export function inspect(provider:NoInfer<any>){return Effect.provide(provider)(Effect.succeed(7))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-piped", "export function inspect(provider:NoInfer<any>){return Effect.succeed(7).pipe(Effect.provide(provider))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-tuple", "export function inspect(provider:NoInfer<any>){return Effect.provide(Effect.succeed(7),[provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-mixed", "export function inspect(provider:NoInfer<any>){return Effect.provide(Effect.succeed(7),[Layer.empty,provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"no-infer-alias", "export function inspect(provider:NoInfer<any>){const selected=provider;return Effect.provide(Effect.succeed(7),selected)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-keyword", "export effect function inspect(provider:any|Layer.Layer<never>){provide provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-keyword-list", "export effect function inspect(provider:any|Layer.Layer<never>){provide Layer.empty, provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-direct", "export function inspect(provider:any|Layer.Layer<never>){return Effect.provide(Effect.succeed(7),provider)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-curried", "export function inspect(provider:any|Layer.Layer<never>){return Effect.provide(provider)(Effect.succeed(7))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-piped", "export function inspect(provider:any|Layer.Layer<never>){return Effect.succeed(7).pipe(Effect.provide(provider))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-tuple", "export function inspect(provider:any|Layer.Layer<never>){return Effect.provide(Effect.succeed(7),[provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-mixed", "export function inspect(provider:any|Layer.Layer<never>){return Effect.provide(Effect.succeed(7),[Layer.empty,provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"union-alias", "export function inspect(provider:any|Layer.Layer<never>){const selected=provider;return Effect.provide(Effect.succeed(7),selected)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-keyword", "export effect function inspect(provider:any&{}){provide provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-keyword-list", "export effect function inspect(provider:any&{}){provide Layer.empty, provider {return 7}};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-direct", "export function inspect(provider:any&{}){return Effect.provide(Effect.succeed(7),provider)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-curried", "export function inspect(provider:any&{}){return Effect.provide(provider)(Effect.succeed(7))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-piped", "export function inspect(provider:any&{}){return Effect.succeed(7).pipe(Effect.provide(provider))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-tuple", "export function inspect(provider:any&{}){return Effect.provide(Effect.succeed(7),[provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-mixed", "export function inspect(provider:any&{}){return Effect.provide(Effect.succeed(7),[Layer.empty,provider])};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"intersection-alias", "export function inspect(provider:any&{}){const selected=provider;return Effect.provide(Effect.succeed(7),selected)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
}

func TestProvideAnyNativeChannels(t *testing.T) {
	for _, tc := range provideAnyCases {
		t.Run(tc.name, func(t *testing.T) {
			p, _, _, _ := editorProgram(t, tc.source)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), nil), p.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected %s", d.String())
				}
			}
		})
	}
}
func TestProvideAnyKeepsUnknownRejection(t *testing.T) {
	p, _, _, _ := editorProgram(t, "export function inspect(provider:unknown){return Effect.provide(Effect.succeed(7),provider)}")
	found := false
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Code() == 2769 {
			found = true
		}
	}
	if !found {
		t.Fatal("unknown provider lost native overload rejection")
	}
}

// A generic parameter retains native overload checking even with an any bound.
func TestProvideAnyKeepsGenericRejection(t *testing.T) {
	for _, params := range []string{"<K>", "<K extends any>", "<K extends unknown>"} {
		t.Run(params, func(t *testing.T) {
			p, _, _, _ := editorProgram(t, "export function inspect"+params+"(provider:K){return Effect.provide(Effect.succeed(7),provider)}")
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == 2769 {
					found = true
				}
			}
			if !found {
				t.Fatal("generic provider lost the native overload rejection")
			}
		})
	}
}
