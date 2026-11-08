package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestClockReadReceiver(t *testing.T) {
	rows := []struct {
		name, source string
		host         bool
	}{
		{"performance parameter", "export function read(p: Performance){return p.now()}", false},
		{"crypto parameter", "export function read(c: Crypto){return c.randomUUID()}", false},
		{"random bytes parameter", "export function read(c: Crypto){return c.getRandomValues(new Uint8Array(2))}", false},
		{"boxed performance", "export function read(input:{clock:Performance}){return input.clock.now()}", false},
		{"injected page", "export function read(page:Window & typeof globalThis){return page.performance.now()}", false},
		{"injected page crypto", "export function read(page:Window & typeof globalThis){return page.crypto.randomUUID()}", false},
		{"asserted parameter", "export function read(p:Performance){return (p as Performance).now()}", false},
		{"optional parameter", "export function read(p:Performance|undefined){return p?.now()}", false},
		{"literal member", "export function read(p:Performance){return p[\"now\"]()}", false},
		{"template member", "export function read(p:Performance){return p[\x60now\x60]()}", false},
		{"aliased parameter", "export function read(p:Performance){const alias=p;return alias.now()}", false},
		{"method parameter", "export function read(now:Performance[\"now\"]){return now()}", false},
		{"crypto method parameter", "export function read(uuid:Crypto[\"randomUUID\"]){return uuid()}", false},
		{"bound method", "export function read(p:Performance){const now=p.now.bind(p);return now()}", false},
		{"destructured method", "export function read(p:Performance){const {now}=p;return now()}", false},
		{"service receiver", "service Input {static readonly key=\"test/Input\";clock:Performance};export effect function read(){const clock=(try Input).clock;return try Effect.try(()=>clock.now())}", false},
		{"host performance", "export function read(){return performance.now()}", true},
		{"host crypto", "export function read(){return crypto.randomUUID()}", true},
		{"host random bytes", "export function read(){return crypto.getRandomValues(new Uint8Array(2))}", true},
		{"globalThis performance", "export function read(){return globalThis.performance.now()}", true},
		{"globalThis crypto literal", "export function read(){return globalThis[\"crypto\"].randomUUID()}", true},
		{"window performance", "export function read(){return window.performance.now()}", true},
		{"asserted host", "export function read(){return (globalThis.performance as Performance).now()}", true},
		{"aliased host", "const p=performance;export function read(){return p.now()}", true},
		{"captured host method", "const now=performance.now;export function read(){return now()}", true},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, row.source)
			var host int
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4402.Code {
					host++
					continue
				}
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("unexpected error: %s", diagnosticWithNotes(d))
				}
			}
			if row.host != (host > 0) {
				t.Fatalf("want EK4402=%t, got %d; source %s", row.host, host, row.source)
			}
		})
	}
}
