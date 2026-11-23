package vibelangfmt

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func benchFmtSource(modules int) string {
	var b strings.Builder
	b.Grow(modules * 800)
	for i := range modules {
		fmt.Fprintf(&b, `export error Missing%d { id: string }

export schema Rec%d {
  id: string
  count: number
  tag?: "a" | "b"
}

export service Store%d {
  get(id: string): number!Missing%d
  size: number
}

export effect function load%d(id: string): number!!Store%d {
  const store = try Store%d
  return (store.get(id) |> Effect.map(%%, (count) => count + 1)) catch (e) => match (e) {
    when Missing%d: 0;
  }
}
`, i, i, i, i, i, i, i, i)
	}
	return b.String()
}

func identityTSFormatter(text string) (string, error) {
	return text, nil
}

func BenchmarkFormat(b *testing.B) {
	for _, tc := range []struct {
		name    string
		modules int
	}{
		{"Small_1mod", 1},
		{"Medium_15mod", 15},
		{"Large_50mod", 50},
	} {
		src := benchFmtSource(tc.modules)
		if _, err := Format("bench.vibe", src, identityTSFormatter); err != nil {
			b.Fatalf("%s: Format failed: %v", tc.name, err)
		}
		b.Run(tc.name, func(b *testing.B) {
			b.SetBytes(int64(len(src)))
			b.ReportAllocs()
			for b.Loop() {
				out, err := Format("bench.vibe", src, identityTSFormatter)
				if err != nil || len(out) == 0 {
					b.Fatalf("Format error: %v", err)
				}
			}
		})
	}
}

func BenchmarkEncodeDecode(b *testing.B) {
	src := benchFmtSource(15)
	b.Run("Encode_15mod", func(b *testing.B) {
		b.SetBytes(int64(len(src)))
		b.ReportAllocs()
		for b.Loop() {
			enc, err := encode("bench.vibe", src)
			if err != nil || len(enc.text) == 0 {
				b.Fatalf("encode error: %v", err)
			}
		}
	})
	enc, err := encode("bench.vibe", src)
	if err != nil {
		b.Fatal(err)
	}
	b.Run("Decode_15mod", func(b *testing.B) {
		b.SetBytes(int64(len(enc.text)))
		b.ReportAllocs()
		for b.Loop() {
			out, err := enc.decode(enc.text)
			if err != nil || len(out) == 0 {
				b.Fatalf("decode error: %v", err)
			}
		}
	})
	b.Run("SameProgram_15mod", func(b *testing.B) {
		b.SetBytes(int64(len(src)))
		b.ReportAllocs()
		for b.Loop() {
			if err := sameProgram("bench.vibe", src, src); err != nil {
				b.Fatalf("sameProgram error: %v", err)
			}
		}
	})
}

func BenchmarkWriteArchive(b *testing.B) {
	dir := b.TempDir()
	executable := filepath.Join(dir, "vibelang")
	payload := make([]byte, 256*1024)
	for i := range payload {
		payload[i] = byte(i*31 + 7)
	}
	if err := os.WriteFile(executable, payload, 0o755); err != nil {
		b.Fatal(err)
	}
	output := filepath.Join(dir, "plugin.zip")
	b.SetBytes(int64(len(payload)))
	b.ReportAllocs()
	for b.Loop() {
		sum, err := writeArchive(output, executable, "vibelang")
		if err != nil || sum == "" {
			b.Fatalf("writeArchive error: %v", err)
		}
	}
}
