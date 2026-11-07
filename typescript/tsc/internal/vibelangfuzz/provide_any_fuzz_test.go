package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

var provideAnyRules = []struct{ key, source string }{
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
	{"any-stored-provide", "const supply=Effect.provide; export function inspect(provider:any){return supply(Effect.succeed(7),provider)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-stored-provide-curried", "const supply=Effect.provide; export function inspect(provider:any){return supply(provider)(Effect.succeed(7))};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-renamed-provide-namespace", "import {Effect as Fx} from \"effect\"; export function inspect(provider:any){return Fx.provide(Fx.succeed(7),provider)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
	{"any-renamed-provide-import", "import {provide as supply,succeed} from \"effect/Effect\"; export function inspect(provider:any){return supply(succeed(7),provider)};type Channels<T> = T extends Effect.Effect<infer A,infer E,infer R> ? [A,E,R] : never;\ntype Equal<A,B> = (<T>()=>T extends A ? 1 : 2) extends (<T>()=>T extends B ? 1 : 2) ? true : false;\nexport const exact:Equal<Channels<ReturnType<typeof inspect>>,[number,unknown,unknown]> = true;"},
}

const provideAnyQuote = "VibeLang adds no typing rules of its own: Effect's `provide` types everything."

func provideAnyChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(servicesRulesChapter(t), provideAnyQuote) {
		t.Fatalf("chapter 5 no longer says %q", provideAnyQuote)
	}
}
func TestProvideAnyQuoted(t *testing.T) { provideAnyChapter(t) }
func FuzzProvideAnyNativeChannels(f *testing.F) {
	startShortBudget(f)
	provideAnyChapter(f)
	for _, r := range provideAnyRules {
		f.Add([]byte(r.key))
		f.Add([]byte(r.key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := 0
		if len(data) > 0 {
			i = int(data[0]) % len(provideAnyRules)
		}
		parts := strings.SplitN(string(data), "\x00", 2)
		for j, r := range provideAnyRules {
			if parts[0] == r.key {
				i = j
				break
			}
		}
		r := provideAnyRules[i]
		source := r.source
		var variant byte
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		if variant&1 != 0 {
			source = "// retained trivia\r\n" + source
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "inspect", "selected")
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var codes []int32
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		if len(codes) > 0 {
			Gap(t, "FuzzProvideAnyNativeChannels", r.key, "chapter 5: %s; native unknown E/R assertions must compile, got %v", provideAnyQuote, codes)
			return
		}
		ExpectPending(t, "FuzzProvideAnyNativeChannels", r.key)
		ExpectPending(t, "FuzzProvideAnyNativeChannels", specCorpusKey(t))
	})
}
