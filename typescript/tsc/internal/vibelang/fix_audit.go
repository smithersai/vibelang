package vibelang

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// fixAudit keeps source in private, explicitly requested artifacts, never in
// diagnostic output. Each run owns a directory and each snapshot is immutable.
type fixAudit struct {
	root, run, phase string
	round            int
	err              error
}

func newFixAudit() *fixAudit {
	root := os.Getenv("VIBELANG_FIX_AUDIT_DIR")
	if root == "" {
		return nil
	}
	return &fixAudit{root: root, phase: "start"}
}

func (s *fixSites) auditPhase(phase string, round int) {
	if s != nil && s.audit != nil {
		s.audit.phase, s.audit.round = phase, round
	}
}

func (a *fixAudit) record(site RefusedSite, text string, start, end int) {
	if a == nil || a.err != nil {
		return
	}
	a.err = a.write(site, text, start, end)
}

func (a *fixAudit) write(site RefusedSite, text string, start, end int) error {
	if a.run == "" {
		if err := os.MkdirAll(a.root, 0700); err != nil {
			return err
		}
		run, err := os.MkdirTemp(a.root, "run-")
		if err != nil {
			return err
		}
		a.run = run
	}
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
	source := digest + ".source"
	path := filepath.Join(a.run, source)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if os.IsExist(err) {
		saved, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if !bytes.Equal(saved, []byte(text)) {
			return fmt.Errorf("refusal audit snapshot changed")
		}
	} else if err != nil {
		return err
	} else {
		_, writeErr := file.WriteString(text)
		closeErr := file.Close()
		if writeErr != nil {
			return writeErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	line, column := lineColumn(text, start)
	endLine, endColumn := lineColumn(text, end)
	record := struct {
		Version       int    `json:"version"`
		File          string `json:"file"`
		Phase         string `json:"phase"`
		Round         int    `json:"round"`
		Source        string `json:"source"`
		Start         int    `json:"start"`
		End           int    `json:"end"`
		Line          int    `json:"line"`
		Column        int    `json:"column"`
		EndLine       int    `json:"endLine"`
		EndColumn     int    `json:"endColumn"`
		Code          string `json:"code"`
		OriginalStart int    `json:"originalStart"`
		OriginalEnd   int    `json:"originalEnd"`
		New           bool   `json:"new"`
	}{1, site.File.AsString(), a.phase, a.round, source, start, end, line, column, endLine, endColumn, site.Code, site.Start, site.End, site.New}
	entry, err := os.OpenFile(filepath.Join(a.run, "refusals.jsonl"), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	encodeErr := json.NewEncoder(entry).Encode(record)
	closeErr := entry.Close()
	if encodeErr != nil {
		return encodeErr
	}
	return closeErr
}
