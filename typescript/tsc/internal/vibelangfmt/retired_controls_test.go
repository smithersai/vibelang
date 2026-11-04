package vibelangfmt

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

// VIP-35: "the first release ships without handlers." These exact former
// success witnesses now reject before any host formatter can rewrite them.
func TestRetiredControlsRejectBeforeFormatting(t *testing.T) {
	cases := []struct{ name, source, message string }{
		{"control-spacing", "control   Approval{approve():Effect<boolean>}", parser.RetiredControlMessage},
		{"select-among-older-forms", "layer UsersLive: Users {\n  const directory = Directory()\n  find(id) { return directory.get(id) }\n  readonly region = \"eu\"\n}\nservice class Accounts {\n  find(id: string): Account!NotFound\n}\nfunction f(jobs: Queue.Queue<string>) {\n  provide UsersLive {\n    select {\n      case const job = jobs.take(): run(job)\n      default: idle()\n    }\n  }\n  const fiber = fork read()\n  return await fiber\n}\nfunction typed(id: string) {\n  try {\n    return getUser(id).name\n  } catch (e: NotFound) {\n    return \"missing\"\n  } catch (e: Timeout | Offline) {\n    return \"slow\"\n  } catch (e) {\n    return \"other\"\n  } finally {\n    log(\"done\")\n  }\n}\n", parser.RetiredSelectMessage},
	}
	for _, c := range cases {
		for _, suffix := range []string{".vibe", ".vibex"} {
			for _, newline := range []string{"\n", "\r\n"} {
				for _, prefix := range []string{"", "  ", "\t"} {
					source := prefix + strings.ReplaceAll(c.source, "\n", newline)
					called := false
					result, err := Format(c.name+suffix, source, func(text string) (string, error) { called = true; return text, nil })
					if err == nil || !strings.Contains(err.Error(), c.message) || result != "" || called {
						t.Fatalf("%s %s prefix=%q newline=%q: result=%q err=%v host called=%v", c.name, suffix, prefix, newline, result, err, called)
					}
				}
			}
		}
	}
}
