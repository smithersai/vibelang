package vibelangmapper

import (
	"testing"

	"gotest.tools/v3/assert"
)

// TestEK9006Messages pins actionable receiver names and candidate functions,
// including optional access where an annotation alone cannot authorize dispatch.
func TestEK9006Messages(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{`import { get } from "./host"; const todos = get(); todos.map()`, "D253 cannot select a module for this unproven data method: its candidate TypeIds can coexist. Annotate the receiver binding with a type annotation, for example `const todos: Todo[] = …` or `const todos: Cause.Cause<…> = …` or `const todos: Chunk.Chunk<…> = …` or `const todos: Effect.Effect<…> = …` or `const todos: Exit.Exit<…> = …` or `const todos: HashMap.HashMap<…> = …` or `const todos: HashSet.HashSet<…> = …` or `const todos: Option.Option<…> = …` or `const todos: Result.Result<…> = …` or `const todos: Schedule.Schedule<…> = …` or `const todos: Sink.Sink<…> = …` or `const todos: Stream.Stream<…> = …`, or call the module function explicitly: `Array.map(todos, ...)`, `Cause.map(todos, ...)`, `Chunk.map(todos, ...)`, `Effect.map(todos, ...)`, `Exit.map(todos, ...)`, `HashMap.map(todos, ...)`, `HashSet.map(todos, ...)`, `Option.map(todos, ...)`, `Result.map(todos, ...)`, `Schedule.map(todos, ...)`, `Sink.map(todos, ...)`, `Stream.map(todos, ...)`."},
		{`import { maybe } from "./host"; maybe.isSome`, "The mapper cannot decide whether this is a native field or an uncalled data method. Annotate the receiver binding with its native field type, for example `const maybe: { isSome: unknown } = …`."},
		{`import { maybe } from "./host"; maybe?.isSome()`, "D253 data methods require a direct call without optional chaining or uncalled access. Annotate the receiver binding with a type annotation, for example `const maybe: Option.Option<…> = …`, or call the module function explicitly: `Option.isSome(maybe, ...)`."},
	} {
		p := Project(test.source, testContext)
		assert.Equal(t, len(p.Diagnostics), 1)
		assert.Equal(t, p.Diagnostics[0].Message, test.want)
	}
}
