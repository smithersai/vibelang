package vibelangfuzz

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestShardTimingsNameLiveTests(t *testing.T) {
	names := testFunctions(t)
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "shard-seconds.txt"))
	if err != nil {
		t.Fatal(err)
	}
	for i, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 || strings.HasPrefix(fields[0], "#") {
			continue
		}
		if len(fields) != 2 {
			t.Errorf("shard-seconds.txt:%d: expected seconds and a test name", i+1)
			continue
		}
		if seconds, err := strconv.ParseFloat(fields[0], 64); err != nil || seconds <= 0 {
			t.Errorf("shard-seconds.txt:%d: invalid timing", i+1)
		}
		if !names[fields[1]] {
			t.Errorf("shard-seconds.txt:%d: no test named %s", i+1, fields[1])
		}
	}
}

func TestPendingDataHygiene(t *testing.T) {
	private := regexp.MustCompile(`(?i)\b(?:work stream|lane) [\w-]+|\buntil [A-Z][a-z]+ rules\b|\b(?:held|main|vibe) [0-9a-f]{7,12}\b`)
	files, err := filepath.Glob(filepath.Join(repoTestdata(), "pending", "*.txt"))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		records := 0
		for index, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				records++
			}
			if private.MatchString(line) {
				t.Errorf("%s:%d: replace private tracking details with a public rule or issue", filepath.Base(file), index+1)
			}
		}
		if records == 0 {
			t.Errorf("%s has no pending entries", filepath.Base(file))
		}
	}
}

// Corpus files can repeat fixture comments verbatim. Check them as well as the
// source fixture so a minimized test cannot preserve private build host names.
func TestCorpusHostHygiene(t *testing.T) {
	private := regexp.MustCompile(`(?i)\bnyc-0[12]\s+repros/|\bminimized by [\w-]+ \(nyc-`)
	err := filepath.WalkDir(filepath.Join(repoTestdata(), "fuzz"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if private.Match(data) {
			t.Errorf("%s: replace internal host and work stream details with a public fixture reference", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
