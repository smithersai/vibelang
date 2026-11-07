package vibelang

import "testing"

// A component test drives the page Experimental.Window injects: a member of a
// value the code was given is that value's, while a host global read bare or
// through globalThis or window stays EK4402 (VIP-33, amended 2026-11-07;
// cases/experimental-window-page).
func TestHostGlobalMemberReceiver(t *testing.T) {
	page := "export function drive(page: Window & typeof globalThis) {\n  return "
	rows := []struct {
		name, source string
		host         bool
	}{
		{"injected event constructor", page + `new page.KeyboardEvent("keydown", { key: "Home" })` + "\n}\n", false},
		{"injected custom event", page + `new page.CustomEvent("delta", { detail: 1 })` + "\n}\n", false},
		{"injected prototype", page + "page.Element.prototype.scrollIntoView\n}\n", false},
		{"injected literal key", page + `page["WheelEvent"]` + "\n}\n", false},
		{"injected parenthesized", page + "(page as Window & typeof globalThis).Touch\n}\n", false},
		{"bare constructor", "export const read = KeyboardEvent\n", true},
		{"bare prototype", "export const read = Element.prototype.scrollIntoView\n", true},
		{"bare frame function", "export const read = requestAnimationFrame\n", true},
		{"window member", "export const read = window.scrollY\n", true},
		{"globalThis chain", "export const read = globalThis.window.KeyboardEvent\n", true},
		{"globalThis literal key", `export const read = globalThis["WheelEvent"]` + "\n", true},
		{"globalThis member", "export const read = globalThis.TouchEvent\n", true},
		{"parenthesized host receiver", "export const read = (globalThis.window as Window & typeof globalThis).CustomEvent\n", true},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.source
			var reports []string
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == EK4402.Code {
					reports = append(reports, diagnosticWithNotes(d))
				}
			}
			if row.host != (len(reports) > 0) {
				t.Fatalf("want EK4402 %t, got %d:\n%s\nsource:\n%s", row.host, len(reports), reports, row.source)
			}
		})
	}
}
