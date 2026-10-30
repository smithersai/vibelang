package vibelang

import (
	"fmt"
	stdmaps "maps"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Read the normative table independently of the compiler's registry, including
// errors: a legacy warning that Appendix B does not list is not configurable.
func appendixBSeverityCodes(t *testing.T) map[string]bool {
	t.Helper()
	data, err := os.ReadFile("../../../../docs/design/src/900-appendices.md")
	if err != nil {
		t.Fatal(err)
	}
	_, appendix, ok := strings.Cut(string(data), "## Appendix B. Diagnostics\n")
	if !ok {
		t.Fatal("missing Appendix B")
	}
	appendix, _, _ = strings.Cut(appendix, "\n## ")
	codes := map[string]bool{}
	for _, row := range regexp.MustCompile("(?m)^\\| `?(EK[0-9]{4,})`? \\| (.*)").FindAllStringSubmatch(appendix, -1) {
		codes[row[1]] = regexp.MustCompile(`^(?:lint )?warning\b`).MatchString(row[2])
	}
	if len(codes) == 0 {
		t.Fatal("Appendix B assigns no codes")
	}
	return codes
}

func TestSeverityCodesMatchAppendixB(t *testing.T) {
	own := appendixBSeverityCodes(t)
	for number := range 10000 {
		code := fmt.Sprintf("EK%04d", number)
		_, imported := core.VibeImportedLintCodes[code]
		if got, want := core.VibeSeverityCode(code), own[code] || imported; got != want {
			t.Errorf("%s configurable = %v, want %v from Appendix B/imported registry", code, got, want)
		}
	}
	for code := range core.VibeImportedLintCodes {
		if !core.VibeSeverityCode(code) {
			t.Errorf("assigned imported code %s rejected", code)
		}
	}
	for _, code := range []string{"", "EK508", "EK00508", "ek0508", "EK0508x", "EK38131", "EK99999"} {
		if core.VibeSeverityCode(code) {
			t.Errorf("unknown code %q accepted", code)
		}
	}
}

func TestAppendixBSeveritySettingsTakeEffect(t *testing.T) {
	own := appendixBSeverityCodes(t)
	for _, severity := range []string{"error", "warning", "suggestion", "off"} {
		t.Run(severity, func(t *testing.T) {
			entries, want := map[string]string{}, map[string]string{}
			for code, warning := range own {
				if warning {
					entries[code] = severity
					want[code] = severity
				}
			}
			for code := range core.VibeImportedLintCodes {
				entries[code] = severity
				want[code] = severity
			}
			// Invalid entries share the map with valid ones. They report EK3006 even
			// when retaining "error", and never disable the other settings.
			for code := range own {
				entries[code] = severity
			}
			for _, code := range []string{"EK9999", "EK3800", "EK38131", "EK1012", "EK4840"} {
				entries[code] = severity
			}
			var fields []string
			for code, value := range entries {
				fields = append(fields, fmt.Sprintf("%q:%q", code, value))
			}
			text := `{"vibe":{"severities":{` + strings.Join(fields, ",") + `}},"files":["main.vibe"]}`
			fs := vfstest.FromMap(map[string]string{"/p/tsconfig.json": text, "/p/main.vibe": "export const n=1"}, tspath.CaseSensitive)
			parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/p/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			rejected := map[string]bool{}
			for _, d := range parsed.Errors {
				if d.Source() != "EK" || d.Code() != 3006 || d.File() == nil {
					t.Fatalf("unexpected diagnostic: %v", d)
				}
				code := strings.Trim(text[d.Pos():d.End()], `"`)
				if _, valid := want[code]; valid {
					t.Errorf("configurable %s rejected: %v", code, d)
				}
				if _, exists := entries[code]; !exists || rejected[code] {
					t.Errorf("unexpected or duplicate rejection of %q", code)
				}
				rejected[code] = true
			}
			if len(parsed.Errors) != len(entries)-len(want) {
				t.Errorf("got %d invalid entries, want %d", len(parsed.Errors), len(entries)-len(want))
			}
			options := parsed.CompilerOptions()
			if options.VibeLang == nil || !stdmaps.Equal(options.VibeLang.Severities, want) {
				t.Errorf("valid settings lost or invalid settings retained: %+v", options.VibeLang)
			}
			for code := range want {
				n, err := strconv.Atoi(strings.TrimPrefix(code, "EK"))
				if err != nil {
					t.Fatal(err)
				}
				m := registry[int32(n)]
				if m == nil {
					m = message(int32(n), warningCategory, "test warning")
				}
				got, on := category(options, m)
				expected := map[string]diagnostics.Category{"error": diagnostics.CategoryError, "warning": diagnostics.CategoryWarning, "suggestion": diagnostics.CategorySuggestion}[severity]
				if on != (severity != "off") || on && got != expected {
					t.Errorf("%s setting %q: category=%v on=%v", code, severity, got, on)
				}
			}
		})
	}
}
