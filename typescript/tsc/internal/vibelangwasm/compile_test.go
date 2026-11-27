package vibelangwasm

import (
	"strings"
	"testing"
)

func TestCompileServicesAndTypedErrors(t *testing.T) {
	source := `error UserNotFound { id: string }

interface User {
  readonly id: string
  readonly name: string
}

service Users {
  find(id: string): User!UserNotFound
}

const UsersLive = Layer.succeed(Users, {
  find: effect (id: string) => {
    if (id === "42") {
      return { id: "42", name: "Ada Lovelace" }
    }
    throw new UserNotFound({ id })
  }
})

export effect function greetUser(id: string) {
  const users = try Users
  const user = users.find(id) catch () => ({ id, name: "Guest" })
  return ` + "`Hello, ${user.name}!`" + `
}

export effect function main() {
  provide UsersLive {
    return try greetUser("42")
  }
}
`
	resp := CompileInMemory(CompileRequest{Filename: "services.vibe", Source: source})
	assertNoErrors(t, resp)
	if !strings.Contains(resp.JS, "UserNotFound") {
		t.Fatalf("expected JS to contain UserNotFound, got:\n%s", resp.JS)
	}
	if !strings.Contains(resp.TSProjection, "Effect") {
		t.Fatalf("expected TSProjection to contain Effect lowering, got:\n%s", resp.TSProjection)
	}
	if !strings.Contains(resp.DTS, "greetUser") {
		t.Fatalf("expected DTS to contain greetUser declaration, got:\n%s", resp.DTS)
	}
	if resp.ElapsedMs <= 0 {
		t.Fatalf("expected positive elapsedMs, got %v", resp.ElapsedMs)
	}
}

func TestCompileDataMatchAndPipe(t *testing.T) {
	source := `schema Priority = "low" | "normal" | "urgent"

data Delivery {
  Waiting
  Sent { tracking: string; priority: Priority }
  Rejected { reason: string }
}

export function describe(delivery: Delivery): string {
  return match (delivery) {
    when { _tag: "Waiting" }: "Waiting for dispatch";
    when { _tag: "Sent", let tracking, let priority }: ` + "`[${priority}] ${tracking}`" + `;
    when { _tag: "Rejected", let reason }: ` + "`Rejected: ${reason}`" + `;
  }
}

function shout(text: string): string {
  return text.toUpperCase()
}

export const banner = Delivery.Sent({ tracking: "pkg-7", priority: "urgent" }) |> describe(%) |> shout(%)
`
	resp := CompileInMemory(CompileRequest{Filename: "data.vibe", Source: source})
	assertNoErrors(t, resp)
	if !strings.Contains(resp.JS, "Delivery") {
		t.Fatalf("expected JS to contain Delivery, got:\n%s", resp.JS)
	}
	if !strings.Contains(resp.TSProjection, "Data.taggedEnum") && !strings.Contains(resp.TSProjection, "Delivery") {
		t.Fatalf("expected TSProjection to lower data Delivery, got:\n%s", resp.TSProjection)
	}
}

func TestCompileStructuredConcurrency(t *testing.T) {
	source := `export effect function step(id: number) {
  try sleep("10 millis")
  return id * 10
}

export effect function runAll() {
  const pair = try.all [step(1), step(2)]
  const first = try.race [step(3), step(4)]
  const fiber = fork step(5)
  const joined = join fiber
  for concurrent(3) (const n of [1, 2, 3]) {
    try Console.log("job", n)
  }
  return { pair, first, joined }
}
`
	resp := CompileInMemory(CompileRequest{Filename: "concurrency.vibe", Source: source})
	assertNoErrors(t, resp)
	if !strings.Contains(resp.JS, "runAll") {
		t.Fatalf("expected JS to contain runAll, got:\n%s", resp.JS)
	}
}

func TestCompileReportsVibeLangDiagnostics(t *testing.T) {
	cases := []struct {
		name         string
		source       string
		wantPrefix   string
		wantMinLines int
	}{
		{
			name:         "missing function keyword EK0101",
			source:       "effect broken() { return 1 }\n",
			wantPrefix:   "EK",
			wantMinLines: 1,
		},
		{
			name:         "service class EK0909",
			source:       "service class Legacy { run(): number!! }\n",
			wantPrefix:   "EK0909",
			wantMinLines: 1,
		},
		{
			name:         "try outside effect",
			source:       "function plain() { return try Effect.succeed(1) }\n",
			wantPrefix:   "EK",
			wantMinLines: 1,
		},
		{
			name:         "new service EK3003",
			source:       "service Clock { now(): number!! }\nconst x = new Clock()\n",
			wantPrefix:   "EK3003",
			wantMinLines: 2,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := CompileInMemory(CompileRequest{Filename: "bad.vibe", Source: tc.source})
			if len(resp.Diagnostics) == 0 {
				t.Fatalf("expected diagnostics for %q, got none", tc.name)
			}
			found := false
			for _, d := range resp.Diagnostics {
				if strings.HasPrefix(d.Code, tc.wantPrefix) {
					found = true
					if d.Line < tc.wantMinLines || d.Col < 1 || d.EndLine < d.Line || d.EndCol < 1 {
						t.Errorf("invalid diagnostic coordinates: %+v", d)
					}
				}
			}
			if !found {
				t.Fatalf("expected diagnostic starting with %q, got %+v", tc.wantPrefix, resp.Diagnostics)
			}
		})
	}
}

func TestCompileTypeErrorAndFilenameNormalization(t *testing.T) {
	resp := CompileInMemory(CompileRequest{
		Filename: "",
		Source:   "export const count: number = \"not-a-number\"\n",
	})
	hasTS := false
	for _, d := range resp.Diagnostics {
		if strings.HasPrefix(d.Code, "TS") {
			hasTS = true
		}
	}
	if !hasTS {
		t.Fatalf("expected TS type error diagnostic, got %+v", resp.Diagnostics)
	}
	if normalizeFilename("") != "playground.vibe" {
		t.Fatalf("expected default filename playground.vibe, got %q", normalizeFilename(""))
	}
	if normalizeFilename("../foo/bar.vibex") != "bar.vibex" {
		t.Fatalf("expected sanitized bar.vibex, got %q", normalizeFilename("../foo/bar.vibex"))
	}
}

func TestCompileEmptySourceDoesNotPanic(t *testing.T) {
	resp := CompileInMemory(CompileRequest{Filename: "empty.vibe", Source: ""})
	if resp.Diagnostics == nil {
		t.Fatalf("expected non-nil empty diagnostics slice")
	}
}

func assertNoErrors(t *testing.T, resp CompileResponse) {
	t.Helper()
	var errs []Diagnostic
	for _, d := range resp.Diagnostics {
		if d.Severity == "error" {
			errs = append(errs, d)
		}
	}
	if len(errs) > 0 {
		t.Fatalf("expected zero errors, got:\n%+v\n--- JS ---\n%s\n--- TSProjection ---\n%s", errs, resp.JS, resp.TSProjection)
	}
}

func TestCompileEffectUIModelAndMsg(t *testing.T) {
	source := `schema CounterModel { count: number; step: number }
data CounterMsg { Increment; SetStep { step: number } }
export function update(m: CounterModel, msg: CounterMsg): CounterModel {
  return match (msg) {
    when { _tag: "Increment" }: { ...m, count: m.count + m.step };
    when { _tag: "SetStep", let step }: { ...m, step };
  }
}
export effect function run() {
  const next = update({ count: 0, step: 1 }, CounterMsg.SetStep({ step: 5 }))
  return update(next, CounterMsg.Increment())
}
`
	resp := CompileInMemory(CompileRequest{Filename: "counter.vibe", Source: source})
	assertNoErrors(t, resp)
}
