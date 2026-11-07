package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const effectProgramPipelineTarget = "FuzzEffectProgramPipelines"

// Pipeline topics are arguments too. A declared Effect parameter takes the
// cold program, including when the caller holds the combinator's result.
func TestEffectProgramPipelinesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), effectGenericArgumentQuote) {
		t.Fatalf("Chapter 2 no longer says %q", effectGenericArgumentQuote)
	}
}

var effectProgramPipelineShapes = []struct{ key, expression string }{
	{"stream-fork-scoped", "Stream.runForEach(Stream.make(1, 2), (n) => Effect.succeed(n)) |> Effect.forkScoped(%)"},
	{"ignore-cause", "e |> Effect.ignoreCause(%)"},
	{"flat-map", "e |> Effect.flatMap(%, (n) => Effect.succeed(n + 1))"},
	{"as", "e |> Effect.as(%, \"done\")"},
	{"as-void", "e |> Effect.asVoid(%)"},
	{"multiple-stages", "e |> Effect.as(%, 2) |> Effect.asVoid(%) |> Effect.ignoreCause(%)"},
}

var effectProgramPipelineContexts = []struct{ key, body string }{
	{"run", "return try (CALL)"},
	{"held", "const held = CALL; return held"},
	{"array", "return [CALL]"},
	{"passed", "return try Effect.all([CALL])"},
}

func FuzzEffectProgramPipelines(f *testing.F) {
	startShortBudget(f)
	for _, shape := range effectProgramPipelineShapes {
		for _, context := range effectProgramPipelineContexts {
			f.Add(shape.key, context.key)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shapeKey, contextKey string) {
		TestEffectProgramPipelinesQuoted(t)
		shapeIndex := slices.IndexFunc(effectProgramPipelineShapes, func(shape struct{ key, expression string }) bool { return shape.key == shapeKey })
		contextIndex := slices.IndexFunc(effectProgramPipelineContexts, func(context struct{ key, body string }) bool { return context.key == contextKey })
		if shapeIndex < 0 {
			if shapeKey == "" {
				return
			}
			shapeIndex = int(shapeKey[0]) % len(effectProgramPipelineShapes)
		}
		if contextIndex < 0 {
			if contextKey == "" {
				return
			}
			contextIndex = int(contextKey[0]) % len(effectProgramPipelineContexts)
		}
		shape, context := effectProgramPipelineShapes[shapeIndex], effectProgramPipelineContexts[contextIndex]
		key := shape.key + ":" + context.key
		body := strings.ReplaceAll(context.body, "CALL", "("+shape.expression+")")
		source := "export effect function probe(e: Effect.Effect<number, \"failure\">) { " + body + " }\n"
		var result *Result
		var err error
		within(t, "check program-valued pipeline", func() {
			result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Code() == 4802 || HasError(result.Diagnostics) {
				Gap(t, effectProgramPipelineTarget, key, "VIP-1: declared Effect arguments retain the program, got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		ExpectPending(t, effectProgramPipelineTarget, key)
	})
}
