package vibelang

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// nativePipeHandler is opencode's server fetch handler, reduced: in .pipe,
// toWebHandlerWith(context) takes its requirements from the stage's contextual
// type, and as a |> stage it has none, so its |> form fails with TS2345.
const nativePipeHandler = `import { Context, Effect } from "effect"
import { HttpEffect, HttpMiddleware, HttpRouter } from "effect/http"

export const make = Effect.fn("m")(function* (context: Context.Context<HttpRouter.HttpRouter>) {
  yield* Effect.void
  return Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpMiddleware.cors({ maxAge: 1 }), HttpEffect.toWebHandlerWith(context))
})
`

// The gate does not check a generator's body as effect code until the
// generator goes, so EK1002's first fix wrote the .pipe as |> and was refused
// with TS2345, and the generator stayed. Its second fix keeps the .pipe.
func TestEffectGenKeepsAPipeItsStagesNeed(t *testing.T) {
	result := fixProjectOf(t, map[string]string{"main.vibe": nativePipeHandler})
	got := fixedText(result, "main.vibe")
	if result.Err != nil || strings.Contains(got, "Effect.fn") || strings.Contains(got, "function*") {
		t.Fatalf("the generator stayed: %v %+v\n%s", result.Err, result.Refused, got)
	}
	if !strings.Contains(got, ".pipe(HttpMiddleware.cors({ maxAge: 1 }), HttpEffect.toWebHandlerWith(context))") {
		t.Fatalf("the .pipe went:\n%s", got)
	}
	for _, r := range result.Refused {
		if r.Code == EK1002.Code {
			t.Fatalf("EK1002 is reported refused though it was fixed: %+v\n%s", r, got)
		}
	}
}

// A body whose .pipe means the same as |> is written with |>, as before: the
// second fix is only for a first one the gate refused.
func TestEffectGenStillWritesAPipeThatKeepsItsType(t *testing.T) {
	source := "import { Effect } from \"effect\"\nexport const f = Effect.fn(\"f\")(function* (n: number) {\n  return yield* Effect.succeed(n).pipe(Effect.map((x) => x + 1))\n})\n"
	result := fixProjectOf(t, map[string]string{"main.vibe": source})
	got := fixedText(result, "main.vibe")
	if strings.Contains(got, "Effect.fn") || strings.Contains(got, ".pipe(") || !strings.Contains(got, "|>") {
		t.Fatalf("refused %+v, wrote:\n%s", result.Refused, got)
	}
}

// Whatever else the generator does around the handler's .pipe, the generator
// goes, the .pipe stays, and a pipe beside it that means the same as |> is
// still written with |> only when nothing in its generator needs .pipe.
func FuzzEffectGenNativePipeFallback(f *testing.F) {
	for before := range uint8(3) {
		for _, safe := range []bool{false, true} {
			f.Add(before, safe)
		}
	}
	f.Fuzz(func(t *testing.T, before uint8, safe bool) {
		var statements []string
		for i := range int(before) % 3 {
			statements = append(statements, fmt.Sprintf("  const v%d = yield* Effect.succeed(%d)", i, i))
		}
		if safe {
			statements = append(statements, "  const s = yield* Effect.succeed(1).pipe(Effect.map((x) => x + 1))")
		}
		body := strings.Join(statements, "\n")
		if body != "" {
			body += "\n"
		}
		source := strings.Replace(nativePipeHandler, "  yield* Effect.void\n", "  yield* Effect.void\n"+body, 1)
		result := fixProjectIn(t, context.Background(), map[string]string{"main.vibe": source})
		got := fixedText(result, "main.vibe")
		if strings.Contains(got, "function*") || !strings.Contains(got, "HttpEffect.toWebHandlerWith(context))") {
			t.Fatalf("refused %+v, wrote:\n%s\nfrom:\n%s", result.Refused, got, source)
		}
	})
}
