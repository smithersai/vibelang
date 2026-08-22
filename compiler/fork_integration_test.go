package compiler_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/smithersai/vibelang/compiler"
)

func TestPinnedForkLockMatchesManifest(t *testing.T) {
	manifestBytes, err := os.ReadFile("../typescript-fork.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Revision != compiler.PinnedTypeScriptRevision {
		t.Fatalf("compiler revision %q does not match manifest %q", compiler.PinnedTypeScriptRevision, manifest.Revision)
	}
}

func TestPinnedForkParsesChecksEmitsAndMapsVibe(t *testing.T) {
	checkout := os.Getenv("VIBELANG_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set VIBELANG_TYPESCRIPT_FORK to the exact pinned checkout to run the executable fork test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	backend, err := compiler.NewPinnedFork(ctx, compiler.ForkConfig{
		CheckoutDirectory: checkout,
		CacheDirectory:    t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}

	good, err := backend.Compile(ctx, compiler.CompileRequest{
		RootNames: []string{"main.vibe"},
		Files: []compiler.SourceFile{{
			Path: "main.vibe",
			Kind: compiler.FileKindVibe,
			Text: "export const answer: number = 42;\n",
		}},
		Options: compiler.Options{"sourceMap": true, "inlineSources": true, "declaration": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if good.EmitSkipped || len(good.Diagnostics) != 0 {
		t.Fatalf("unexpected successful result: %#v", good)
	}
	artifacts := artifactsByPath(good.Artifacts)
	if !strings.Contains(string(artifacts["main.js"]), "answer = 42") {
		t.Fatalf("missing TypeScript emitter output: %#v", good.Artifacts)
	}
	if !strings.Contains(string(artifacts["main.d.vibe.ts"]), "declare const answer: number") {
		t.Fatalf("missing content-mapped declaration emitter output: %#v", good.Artifacts)
	}
	var sourceMap struct {
		Sources        []string `json:"sources"`
		SourcesContent []string `json:"sourcesContent"`
		Mappings       string   `json:"mappings"`
	}
	if err := json.Unmarshal(artifacts["main.js.map"], &sourceMap); err != nil {
		t.Fatalf("invalid emitted source map: %v (%q)", err, artifacts["main.js.map"])
	}
	if len(sourceMap.Sources) != 1 || !strings.Contains(sourceMap.Sources[0], "main.vibe") {
		t.Fatalf("source map did not retain authored .vibe identity: %#v", sourceMap)
	}
	if len(sourceMap.SourcesContent) != 1 || sourceMap.SourcesContent[0] != "export const answer: number = 42;\n" || sourceMap.Mappings == "" {
		t.Fatalf("source map did not retain authored content/mappings: %#v", sourceMap)
	}

	badSource := "export const answer: number = \"not a number\";\n"
	bad, err := backend.Compile(ctx, compiler.CompileRequest{
		RootNames: []string{"broken.vibe"},
		Files: []compiler.SourceFile{{
			Path: "broken.vibe",
			Kind: compiler.FileKindVibe,
			Text: badSource,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bad.EmitSkipped || len(bad.Artifacts) != 0 {
		t.Fatalf("type errors must suppress emit: %#v", bad)
	}
	found := false
	for _, diagnostic := range bad.Diagnostics {
		if diagnostic.Code == "TS2322" && diagnostic.File == "broken.vibe" && diagnostic.Span != nil && diagnostic.Span.Start == strings.Index(badSource, "answer") && diagnostic.Span.Length == len("answer") && diagnostic.Phase == compiler.PhaseCheck {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing mapped TS2322 diagnostic: %#v", bad.Diagnostics)
	}
}

func TestPinnedForkRejectsCacheInsideCheckoutBeforeWrite(t *testing.T) {
	checkout := os.Getenv("VIBELANG_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set VIBELANG_TYPESCRIPT_FORK to run the executable fork test")
	}
	cacheBase := filepath.Join(checkout, ".vibelang-overlap-test-cache")
	if _, err := os.Stat(cacheBase); !os.IsNotExist(err) {
		t.Fatalf("test cache path must start absent: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	_, err := compiler.NewPinnedFork(ctx, compiler.ForkConfig{
		CheckoutDirectory: checkout,
		CacheDirectory:    cacheBase,
	})
	if !errors.Is(err, compiler.ErrForkUnavailable) {
		t.Fatalf("expected overlap rejection, got %v", err)
	}
	if _, err := os.Stat(cacheBase); !os.IsNotExist(err) {
		t.Fatalf("overlap rejection wrote into checkout: %v", err)
	}
}

func TestPinnedForkConcurrentColdCachePreparation(t *testing.T) {
	checkout := os.Getenv("VIBELANG_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set VIBELANG_TYPESCRIPT_FORK to run the executable fork test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cache := t.TempDir()
	start := make(chan struct{})
	errorsByBuilder := make([]error, 2)
	var wait sync.WaitGroup
	for index := range errorsByBuilder {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			_, errorsByBuilder[index] = compiler.NewPinnedFork(ctx, compiler.ForkConfig{
				CheckoutDirectory: checkout,
				CacheDirectory:    cache,
			})
		}(index)
	}
	close(start)
	wait.Wait()
	for index, err := range errorsByBuilder {
		if err != nil {
			t.Fatalf("builder %d failed: %v", index, err)
		}
	}
}

func artifactsByPath(artifacts []compiler.Artifact) map[string][]byte {
	result := make(map[string][]byte, len(artifacts))
	for _, artifact := range artifacts {
		result[artifact.Path] = artifact.Content
	}
	return result
}
