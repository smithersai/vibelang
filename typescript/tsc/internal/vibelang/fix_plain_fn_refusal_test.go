package vibelang

import (
	"strings"
	"testing"
)

func TestPlainEffectFnRefusal(t *testing.T) {
	for _, callee := range []string{"Effect.fn", "Effect.fn(\"work\")", "Effect.fn(\"work\", { attributes: { operation: \"proof\" } })"} {
		for _, callback := range []string{
			"(n: number) => Effect.succeed(n + 1)",
			"(n: number) => { return Effect.succeed(n + 1) }",
			"function(n: number) { return Effect.succeed(n + 1) }",
		} {
			t.Run(callee+"/"+callback, func(t *testing.T) {
				call := callee + "(" + callback + ")"
				source := "export const work = " + call + "\n"
				got, result := fixedPipe(t, source)
				if result.Err != nil || len(result.Changed) != 0 {
					t.Fatalf("fix failed: %v; changed: %+v", result.Err, result.Changed)
				}
				var sites []RefusedSite
				for _, site := range result.Sites {
					if site.Code == "EK1002" {
						sites = append(sites, site)
					}
				}
				if len(sites) != 1 || !strings.Contains(sites[0].Reason, "not an inline generator") {
					t.Fatalf("want one explicit plain callback refusal, got %+v; wrote:\n%s", result.Sites, got)
				}
				if strings.TrimSpace(source[sites[0].Start:sites[0].End]) != call || !SiteHolds(source, got, sites[0]) {
					t.Fatalf("refused callback changed: %+v\n%s", sites[0], got)
				}
			})
		}
	}
}

func TestPlainEffectFnRefusalBindings(t *testing.T) {
	for _, source := range []string{
		"import { Effect as E } from \"effect\"\nexport const work = E.fn((n: number) => E.succeed(n))\n",
		"import * as E from \"effect/Effect\"\nexport const work = E.fn(\"work\")((n: number) => E.succeed(n))\n",
		"import { fn as wrap, succeed } from \"effect/Effect\"\nexport const work = wrap((n: number) => succeed(n))\n",
		"const body = (n: number) => Effect.succeed(n)\nexport const work = Effect.fn(body)\n",
		"export const work = Effect.fn(((n: number) => Effect.succeed(n)))\n",
	} {
		_, result := fixedPipe(t, source)
		count := 0
		for _, site := range result.Sites {
			if site.Code == "EK1002" && strings.Contains(site.Reason, "not an inline generator") {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("want one callback refusal, got %+v\n%s", result.Sites, source)
		}
	}
}

func TestPlainEffectFnRefusalControls(t *testing.T) {
	for _, source := range []string{
		"export const builder = Effect.fn(\"work\")\n",
		"export const work = Effect.fn(function*(n: number) { return n + 1 })\n",
		"export const work = Effect.fn(\"work\")(function*(n: number) { return n + 1 })\n",
		"const Effect = { fn: (body: (n: number) => number) => body }\nexport const work = Effect.fn((n: number) => n + 1)\n",
		"export const work = ((n: number) => n + 1)\n",
	} {
		_, result := fixedPipe(t, source)
		for _, site := range result.Sites {
			if strings.Contains(site.Reason, "not an inline generator") {
				t.Fatalf("false callback refusal: %+v\n%s", site, source)
			}
		}
	}
}

func TestPlainEffectFnImmediateInvocation(t *testing.T) {
	for _, callee := range []string{"Effect.fn", "Effect.fn(\"work\")", "Effect.fn(\"work\", { attributes: { operation: \"proof\" } })"} {
		for _, callback := range []string{
			"(f: () => number) => Effect.succeed(f())",
			"(f: () => number) => { return Effect.succeed(f()) }",
			"function(f: () => number) { return Effect.succeed(f()) }",
		} {
			wrapper := callee + "(" + callback + ")"
			source := "export const value = " + wrapper + "(() => 1)\n"
			got, result := fixedPipe(t, source)
			count := 0
			for _, site := range result.Sites {
				if site.Code != "EK1002" || !strings.Contains(site.Reason, "not an inline generator") {
					continue
				}
				count++
				if strings.TrimSpace(source[site.Start:site.End]) != wrapper || !SiteHolds(source, got, site) {
					t.Fatalf("the invocation was mistaken for a wrapper: %+v\n%s", site, got)
				}
			}
			if result.Err != nil || count != 1 {
				t.Fatalf("want one wrapper refusal: err=%v sites=%+v", result.Err, result.Sites)
			}
		}
	}
}
