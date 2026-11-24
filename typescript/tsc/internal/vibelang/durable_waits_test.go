package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func builtinsProgram(t *testing.T, source string) (*compiler.Program, *ast.SourceFile) {
	t.Helper()
	config := strings.TrimSuffix(editorTsconfig, "}") + `,"vibe":{"experimental":["builtins"]}}`
	program, file, _, _ := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
	return program, file
}

func durableEmitJS(t *testing.T, source string) string {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	cfgText := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true},"vibe":{"experimental":["builtins"]},"files":["main.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfgText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	cfg, errs := tsoptions.GetParsedCommandLineOfConfigFile(
		tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))),
		&core.CompilerOptions{}, nil, fs, nil,
	)
	if len(errs) != 0 {
		t.Fatalf("config: %v", errs)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{
		Config: cfg,
		Host:   compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
	})
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("unexpected diagnostic: %s", d.String())
		}
	}
	var js string
	p.Emit(t.Context(), compiler.EmitOptions{
		ForceEmit: true,
		WriteFile: func(name tspath.RootedFilePath, data string, _ *compiler.WriteFileData) error {
			if strings.HasSuffix(name.AsString(), "main.js") {
				js = data
			}
			return nil
		},
	})
	return js
}

func TestDurableWaitsAllowedInWorkflowBody(t *testing.T) {
	t.Parallel()
	source := strings.Join([]string{
		`import { sleep as importedSleep } from "vibelang-runtime/experimental/Durable"`,
		`schema Paid { amount: number }`,
		`schema Choice { score: number }`,
		`export const paid = Experimental.Durable.signal("paid", Paid)`,
		`const pause = Experimental.Durable.sleep`,
		`const { until: waitUntil } = Experimental.Durable`,
		`const { confirm, ask, select, json } = Experimental.Human`,
		`const waitPaid = paid.wait`,
		`task Deploy { effect call(build: string): string!never { return build } }`,
		`export workflow Release {`,
		`  static readonly deadline = "1 hour"`,
		`  effect call(build: string, at: number) {`,
		`    const ok = try Experimental.Human.confirm("ship", build, { timeout: "6 hours" })`,
		`    if (!ok) return "held"`,
		`    const note = try ask("note", "Why?")`,
		`    const env = try select("env", "Where?", ["staging", "prod"])`,
		`    const parsed = try json("score", "Score", Choice)`,
		`    const ok2 = try confirm("again", "Sure?")`,
		`    try Experimental.Durable.sleep("1 minute")`,
		`    try Experimental.Durable.until(at)`,
		`    try pause("2 seconds")`,
		`    try importedSleep("3 seconds")`,
		`    try waitUntil(at)`,
		`    const p1 = try paid.wait()`,
		`    const p2 = try waitPaid("second")`,
		`    const raced = try.race [waitPaid("third"), Experimental.Durable.sleep("1 day")]`,
		`    const both = try.all [Deploy(build), Experimental.Durable.sleep("1 second")]`,
		`    const first = try.any [paid.wait("fourth"), Deploy(build)]`,
		`    return ok2 ? [build, note, env, parsed.score, p1.amount, p2.amount, raced ? 1 : 0, both[0], typeof first].join(":") : "no"`,
		`  }`,
		`}`,
		`export effect function sendAll(run: string) {`,
		`  try Experimental.Human.answer(Release, run, "ship", true)`,
		`  try paid.send(Release, run, { amount: 10 })`,
		`}`,
		``,
	}, "\n")
	program, file := builtinsProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("unexpected error diagnostic: %s", d.String())
		}
	}
}

func TestDurableWaitsRefusedOutsideWorkflow(t *testing.T) {
	t.Parallel()
	source := strings.Join([]string{
		`schema Paid { amount: number }`,
		`export const paid = Experimental.Durable.signal("paid", Paid)`,
		`const pause = Experimental.Durable.sleep`,
		`const { until: waitUntil } = Experimental.Durable`,
		`const { wait } = paid`,
		`const askQ = Experimental.Human.ask`,
		`effect function localSleep(d: string) { return d }`,
		`const fake = { wait: () => Effect.succeed(1) }`,
		`export effect function outsideEffect() {`,
		`  try Experimental.Durable.sleep("1 second")`,
		`  try Experimental.Durable.until(1000)`,
		`  try paid.wait()`,
		`  try Experimental.Human.confirm("c", "ok?")`,
		`  try Experimental.Human.ask("a", "why?")`,
		`  try Experimental.Human.select("s", "pick", ["x"])`,
		`  try Experimental.Human.json("j", "data", Paid)`,
		`  try pause("1 second")`,
		`  try waitUntil(1000)`,
		`  try wait()`,
		`  try askQ("a2", "why?")`,
		`  const okLocal = try localSleep("1 second")`,
		`  const okFake = try fake.wait()`,
		`  return okLocal + ":" + String(okFake)`,
		`}`,
		`task InTask {`,
		`  effect call(x: string): string!never {`,
		`    try Experimental.Durable.sleep("1 second")`,
		`    return x`,
		`  }`,
		`}`,
		`workflow NestedArrow {`,
		`  effect call() {`,
		`    const nested = effect () => { try wait() }`,
		`    void nested`,
		`    return 1`,
		`  }`,
		`}`,
		`// Plain code holding a wait as a value, and library Workflow.toLayer handlers, are allowed.`,
		`export const held = () => paid.wait()`,
		`export const RawWf = Experimental.Durable.workflow("test#Raw", { payload: { id: Schema.String }, success: Schema.String })`,
		`export const RawLayer = RawWf.toLayer(effect ({ id }) => {`,
		`  try Experimental.Durable.sleep("1 second")`,
		`  try paid.wait()`,
		`  return id`,
		`})`,
		``,
	}, "\n")
	program, file := builtinsProgram(t, source)
	var texts []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 5601 {
			texts = append(texts, d.String())
			continue
		}
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("unexpected non-EK5601 error: %s", d.String())
		}
	}
	// 11 calls in outsideEffect + 1 in InTask + 1 in NestedArrow's nested effect = 13 EK5601;
	// localSleep, fake.wait, held(), and RawWf.toLayer must produce 0 EK5601.
	if len(texts) != 13 {
		t.Fatalf("got %d EK5601 diagnostics, want 13:\n%s", len(texts), strings.Join(texts, "\n"))
	}
	hasSleepHint := false
	hasWorkflowHint := false
	for _, msg := range texts {
		if strings.Contains(msg, "`sleep`") {
			hasSleepHint = true
		}
		if strings.Contains(msg, "workflow") {
			hasWorkflowHint = true
		}
	}
	if !hasSleepHint || !hasWorkflowHint {
		t.Fatalf("expected EK5601 messages to mention `sleep` and workflow:\n%s", strings.Join(texts, "\n"))
	}
}

func TestFiberWaitsAndShadowedLocalsInWorkflowBody(t *testing.T) {
	t.Parallel()
	source := strings.Join([]string{
		`task Step { effect call(id: string): string!never { return id } }`,
		`const snooze = sleep`,
		`const bound = timeout`,
		`const durablePause = Experimental.Durable.sleep`,
		`workflow BadWaits {`,
		`  effect call(id: string) {`,
		`    try sleep("1 second")`,
		`    try Effect.sleep("1 second")`,
		`    try Effect.delay(Step(id), "1 second")`,
		`    try snooze("1 second")`,
		`    try timeout(Step(id), "5 seconds")`,
		`    try bound(Step(id), "5 seconds")`,
		`    try Step(id).pipe(Effect.timeout("5 seconds"))`,
		`    try (Step(id) |> timeout(%, "5 seconds"))`,
		`    const r = try.race [Step(id), sleep("1 second")]`,
		`    return r`,
		`  }`,
		`}`,
		`workflow LocalSleep {`,
		`  effect call(id: string) {`,
		`    const sleep = effect (d: string) => d`,
		`    const fakeDurable: typeof durablePause = () => Effect.void`,
		`    try fakeDurable("1 second")`,
		`    return try sleep(id)`,
		`  }`,
		`}`,
		``,
	}, "\n")
	program, file := builtinsProgram(t, source)
	var sleepMsgs, timeoutMsgs, localMsgs []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 5504 {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
			continue
		}
		text := d.String()
		switch {
		case strings.Contains(text, "Use Experimental.Durable.sleep instead"):
			sleepMsgs = append(sleepMsgs, text)
		case strings.Contains(text, "try.race [step, Experimental.Durable.sleep"):
			timeoutMsgs = append(timeoutMsgs, text)
		case strings.Contains(text, "move this work into a task"):
			localMsgs = append(localMsgs, text)
		default:
			t.Fatalf("unexpected EK5504 message: %s", text)
		}
	}
	if len(sleepMsgs) != 5 {
		t.Fatalf("got %d fiber-sleep EK5504 messages, want 5:\n%s", len(sleepMsgs), strings.Join(sleepMsgs, "\n"))
	}
	if len(timeoutMsgs) != 4 {
		t.Fatalf("got %d fiber-timeout EK5504 messages, want 4:\n%s", len(timeoutMsgs), strings.Join(timeoutMsgs, "\n"))
	}
	if len(localMsgs) != 2 {
		t.Fatalf("got %d local-sleep/fakeDurable generic EK5504 messages, want 2:\n%s", len(localMsgs), strings.Join(localMsgs, "\n"))
	}
}

func TestWorkflowTryRaceAndAnyLowerToDurableRaceSteps(t *testing.T) {
	t.Parallel()
	source := strings.Join([]string{
		`schema Paid { amount: number }`,
		`export const paid = Experimental.Durable.signal("paid", Paid)`,
		`task Ship { effect call(order: string, amount: number): string!never { return order + ":" + String(amount) } }`,
		`task Cancel { effect call(order: string): string!never { return "cancel:" + order } }`,
		`export workflow Checkout {`,
		`  effect call(order: string) {`,
		`    const payment = try.race [paid.wait(), Experimental.Durable.sleep("1 day")]`,
		`    const anyRes = try.any [paid.wait("second"), Ship(order, 1)]`,
		`    return payment ? try Ship(order, payment.amount + (typeof anyRes === "string" ? 1 : anyRes.amount)) : try Cancel(order)`,
		`  }`,
		`}`,
		`export effect function ordinary() {`,
		`  const a = try.race [Effect.succeed(1), Effect.succeed(2)]`,
		`  const b = try.any [Effect.succeed(1), Effect.succeed(2)]`,
		`  return a + b`,
		`}`,
		``,
	}, "\n")
	js := durableEmitJS(t, source)
	if !strings.Contains(js, `vibelang-runtime/experimental/Durable`) {
		t.Fatalf("expected Durable module import in emitted JS:\n%s", js)
	}
	if !strings.Contains(js, `.raceSteps([paid.wait(), Experimental.Durable.sleep("1 day")])`) {
		t.Fatalf("expected workflow try.race to lower to Durable.raceSteps([...]):\n%s", js)
	}
	if !strings.Contains(js, `.raceSteps([paid.wait("second"), Ship(order, 1)], true)`) {
		t.Fatalf("expected workflow try.any to lower to Durable.raceSteps([...], true):\n%s", js)
	}
	if !strings.Contains(js, `.raceAllFirst(`) {
		t.Fatalf("expected ordinary effect function try.race to remain raceAllFirst:\n%s", js)
	}
	if !strings.Contains(js, `.raceAll(`) {
		t.Fatalf("expected ordinary effect function try.any to remain raceAll:\n%s", js)
	}
}

func TestDurableWaitExperimentalGate(t *testing.T) {
	t.Parallel()
	source := strings.Join([]string{
		`export effect function f() {`,
		`  try Experimental.Durable.sleep("1 second")`,
		`}`,
		``,
	}, "\n")
	program, file, _, _ := editorProgram(t, source)
	var codes []int32
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource {
			codes = append(codes, d.Code())
		}
	}
	if len(codes) != 1 || codes[0] != 3013 {
		t.Fatalf("without builtins opt-in, expected only EK3013, got %v", codes)
	}
}
