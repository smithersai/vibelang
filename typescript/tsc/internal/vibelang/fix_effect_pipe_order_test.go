package vibelang

import (
	"strings"
	"testing"
)

func TestEffectPipeCapturesCustomStages(t *testing.T) {
	source := "const trace: string[] = []\nconst stage = () => { trace.push(\"build\"); return (p: number!!): number!! => { trace.push(\"apply\"); return p } }\nexport const result = Effect.succeed(1).pipe(stage(), stage())\n"
	got, result := fixedPipe(t, source)
	if result.Err != nil || len(result.Refused) != 0 || strings.Contains(got, ".pipe(") || !strings.Contains(got, "(() => {") {
		t.Fatalf("custom stages were not captured: %v %+v\n%s", result.Err, result.Refused, got)
	}
	first, second, apply := strings.Index(got, "const pipe$stage0 = stage()"), strings.Index(got, "const pipe$stage1 = stage()"), strings.Index(got, "pipe$program |> pipe$stage0(%)")
	if first < 0 || second <= first || apply <= second {
		t.Fatalf("stage construction does not precede application:\n%s", got)
	}
	again, _ := fixedPipe(t, got)
	if again != got {
		t.Fatalf("not idempotent:\n%s\n%s", got, again)
	}
}

func TestEffectPipeCaptureAvoidsWrittenIdentifiers(t *testing.T) {
	source := "const pipe$program = 7\nconst pipe$stage0 = 8\nconst stage = (p: number!!): number!! => p\nexport const result = Effect.succeed(pipe$program + pipe$stage0).pipe(stage, stage)\n"
	got, result := fixedPipe(t, source)
	if result.Err != nil || strings.Contains(got, ".pipe(") || !strings.Contains(got, "const pipe$program$1 = ") || !strings.Contains(got, "const pipe$stage0$1 = stage") {
		t.Fatalf("capture names are not fresh: %v %+v\n%s", result.Err, result.Refused, got)
	}
}

func TestEffectPipeCaptureKeepsInterstageComments(t *testing.T) {
	source := "const stage = (p: number!!): number!! => p\nexport const result = Effect.succeed(1).pipe(stage, /* keep association */ stage)\n"
	got, result := fixedPipe(t, source)
	if !strings.Contains(got, ".pipe(stage, /* keep association */ stage)") {
		t.Fatalf("comment association changed:\n%s", got)
	}
	found := false
	for _, refusal := range result.Refused {
		found = found || strings.Contains(refusal.Error, "comments between custom stages")
	}
	if !found {
		t.Fatalf("missing comment refusal: %+v", result.Refused)
	}
}

func TestEffectPipeKeepsReceiverSensitiveStage(t *testing.T) {
	source := "const holder = { stage(this: unknown, p: number!!): number!! { return this ? p : Effect.succeed(0) } }\nexport const result = Effect.succeed(1).pipe(holder.stage)\n"
	got, result := fixedPipe(t, source)
	if !strings.Contains(got, ".pipe(holder.stage)") {
		t.Fatalf("receiver-sensitive stage changed: %+v\n%s", result.Refused, got)
	}
	found := false
	for _, refusal := range result.Refused {
		found = found || strings.Contains(refusal.Error, "receiver supplied by .pipe")
	}
	if !found {
		t.Fatalf("missing receiver refusal: %+v", result.Refused)
	}
}

// Stream.runForEach(f), Stream.runDrain and Stream.runHead give a program when
// applied and run nothing, so a pipeline through them needs no captured stages:
// the stage takes the topic first and its callback is typed by the stream.
// Captured, Stream.runForEach((rows) => …) stood alone and rows was unknown, so
// the fix was refused and the generator around it kept its yield* (Smithers'
// stores: rows.pipe(Stream.runForEach(…), Effect.forkIn(scope, …))).
func TestEffectPipeStreamRunStagesStayDataFirst(t *testing.T) {
	for _, test := range []struct{ name, pipe, want string }{
		{"runForEach then fork", "rows.pipe(\n    Stream.runForEach((all) => Effect.log(all.length)),\n    Effect.forkIn(scope, { startImmediately: true }),\n  )",
			"rows\n    |> Stream.runForEach(%, (all) => Effect.log(all.length))\n    |> Effect.forkIn(%, scope, { startImmediately: true })"},
		{"runDrain", "rows.pipe(Stream.take(1), Stream.runDrain, Effect.forkIn(scope))", "rows |> Stream.take(%, 1) |> Stream.runDrain(%) |> Effect.forkIn(%, scope)"},
		{"runHead", "rows.pipe(Stream.filter((all) => all.length > 0), Stream.runHead, Effect.forkIn(scope))", "rows |> Stream.filter(%, (all) => all.length > 0) |> Stream.runHead(%) |> Effect.forkIn(%, scope)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "declare const rows: Stream.Stream<ReadonlyArray<string>>\nexport const f = effect {\n  const scope = try Effect.scope\n  try (" + test.pipe + ")\n}\n"
			got, result := fixedPipe(t, source)
			if result.Err != nil || len(result.Refused) != 0 || strings.Contains(got, "(() => {") || !strings.Contains(got, test.want) {
				t.Fatalf("stream runner stage was captured or refused: %v %+v\n%s", result.Err, result.Refused, got)
			}
		})
	}
}

// A runner that runs the program it receives, Effect.runFork, can change what
// a later stage expression reads, so its pipeline keeps the captured stages.
func TestEffectPipeRunnerStageStaysCaptured(t *testing.T) {
	source := "const trace: string[] = []\nconst stage = () => { trace.push(\"build\"); return (fiber: unknown): number => trace.length }\nexport const result = Effect.succeed(1).pipe(Effect.runFork, stage())\n"
	got, result := fixedPipe(t, source)
	if result.Err != nil || strings.Contains(got, "Effect.runFork(%") || strings.Contains(got, "|> stage()") {
		t.Fatalf("runner stage was applied before a later stage was built: %v %+v\n%s", result.Err, result.Refused, got)
	}
}
