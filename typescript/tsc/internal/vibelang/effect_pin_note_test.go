package vibelang

import (
	"strings"
	"testing"
)

// VIP-32: EK3201's note names only what the compiler knows, its own pin. It
// must not send the user to a VibeLang release for the resolved version,
// which may not exist (a newer effect patch is usually ahead of VibeLang).
func TestEffectPinNoteOffersNoUnknownRelease(t *testing.T) {
	for _, fixture := range []string{"effect-4.1.2", "effect-4.0.3"} {
		t.Run(fixture, func(t *testing.T) {
			packages := map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/" + fixture}
			program, file, _, _ := editorProgramWith(t, "export const n: number = 1", packages)
			pins, _ := pinDiagnostics(t, program, file)
			if len(pins) != 1 {
				t.Fatalf("want one EK3201, got %d", len(pins))
			}
			text := diagnosticWithNotes(pins[0])
			want := "Install effect@" + supportedEffectVersion + " where this project resolves it: VibeLang " + Version + " supports no other effect version."
			if !strings.Contains(text, want) {
				t.Fatalf("EK3201 %q lacks the note %q", text, want)
			}
			if strings.Contains(text, "release that pins") {
				t.Fatalf("EK3201 offers a VibeLang release the compiler cannot know exists: %q", text)
			}
		})
	}
}
