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
