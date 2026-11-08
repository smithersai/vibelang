package vibelangfmt

import (
	"fmt"
	"strings"
	"testing"
)

func TestFormatAdjacentStructuralDeclarations(t *testing.T) {
	heads := []string{"schema Message { id: string }", "error Message { id: string }", "schema error Message { id: string }", "data Message { Value { id: string } }"}
	tails := []string{"export type Alias = string", "export const marker = 1", "export function next() {}", "export class Next {}", "schema Next { value: number }"}
	for _, head := range heads {
		for _, tail := range tails {
			for _, separator := range []string{" ", "; ", "\n", " /* between */ ", "; /* between */ "} {
				source := "/** First docs. */ " + head + separator + "/** Next docs. */ " + tail + "\n"
				t.Run(fmt.Sprintf("%s/%s/%q", head, tail, separator), func(t *testing.T) {
					identity := func(text string) (string, error) { return text, nil }
					enc, err := encode("main.vibe", source)
					if err != nil {
						t.Fatal(err)
					}
					restored, err := enc.decode(enc.text)
					if err != nil || restored != source {
						t.Fatalf("projection changed source: %v\n%s\n%s", err, source, restored)
					}
					once, err := Format("main.vibe", source, identity)
					if err != nil {
						t.Fatal(err)
					}
					twice, err := Format("main.vibe", once, identity)
					if err != nil || twice != once {
						t.Fatalf("not idempotent: %v\n%s\n%s", err, once, twice)
					}
					for _, comment := range []string{"/** First docs. */", "/** Next docs. */"} {
						if strings.Count(once, comment) != 1 {
							t.Fatalf("lost comment %q: %s", comment, once)
						}
					}
				})
			}
		}
	}
	source := "import {Schema} from 'effect'; /** Value docs. */ export schema Message {id:string} /** Type docs. */ export type Message=typeof Message.Type\n"
	if _, err := Format("main.vibe", source, func(text string) (string, error) { return text, nil }); err != nil {
		t.Fatal(err)
	}
}
