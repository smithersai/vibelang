---
title: VibeLang Repository Wiki
tags: [overview, vibelang, smithers-cloud, world-model]
---

# VibeLang Repository Wiki

VibeLang is a language for building reliable TypeScript in the AI era built on top of Effect.ts. VibeLang creates a simple readable syntax for writing Effect.ts that compiles into TypeScript. This allows you to build production-ready systems your team can ship while having full first-class access to the TypeScript ecosystem via first class support for TypeScript interop.

This Obsidian-compatible knowledge base is the shared source of truth for humans and agents working on `smithersai/vibelang` through Smithers Cloud (`https://smithers.sh/smithersai/vibelang/-/wiki`).

## World Model Map

```
               ┌────────────────────────────────────┐
               │   smithers.sh/smithersai/vibelang  │
               │   Personalized UI + Cloud MCP      │
               └──────────┬─────────────┬───────────┘
                          │             │
        ┌─────────────────▼──┐       ┌──▼──────────────────┐
        │  Obsidian Wiki     │       │  5,709-Target Graph │
        │  & Mythical History│       │  build.smithers.sh  │
        └─────────┬──────────┘       └──┬──────────────────┘
                  │                     │
        ┌─────────▼─────────────────────▼──────────────────┐
        │  Go TypeScript 7 Compiler + Effect 4 Runtime     │
        │  4,027+ acceptance cases · 932+ Go fuzz targets  │
        └─────────────────────────┬────────────────────────┘
                                  │ Merge to main
                                  ▼
        ┌──────────────────────────────────────────────────┐
        │  GitHub Mirror -> npm Release + vibelang.sh Docs │
        └──────────────────────────────────────────────────┘
```

## Start Here

- **Origin and Chronicle**: [[Mythical-History|The Mythical History of VibeLang]]
- **Compiler and Tooling**: [[Compiler-Pipeline|Go TypeScript 7 Compiler Pipeline]], [[Language-Design-and-EK-Diagnostics|Language Design and EK Diagnostics]], [[Continuation-Kernel|Continuation Kernel and Effect 4 Runtime]], and [[Editor-LSP-and-Tooling|Editor, LSP, and Tooling Ecosystem]]
- **Build and Cache**: [[Build-Graph-and-Cache|5,709-Target Build Graph and Shared Object Store]]
- **Coding Factory**: [[Smithers-Cloud-Setup|Smithers Cloud Public Factory Setup]], [[Trust-and-Cache-Model|Trust and Cache Model]], [[Backpressure-and-Uphill|Lighthouse Backpressure Audit]], [[Sandbox-and-MCP-Playbook|Sandbox and Cloud MCP Playbook]], [[Public-Roadmap-and-Open-Factory-Issues|Public Roadmap and Open Factory Issues]], and [[Agent-Workflow-Guide|Cloud MCP Agent Workflow Guide]]
- **Governance and Releases**: [[VIP-and-Decision-Log|VIPs and Specification Grading]] and [[Release-and-Security|Automated Releases, Docs Deploy, and Trust Boundaries]]

## Key Numbers

| Dimension | Current Measure | Source of Truth |
| --- | --- | --- |
| Build and test targets | 5,709 | `.smithers/WORKSPACE.ts`, `PACKAGE.ts` |
| Compiler acceptance cases | 4,027+ | `typescript/vibelang/cases/` |
| Go fuzz targets | 932+ | `typescript/tsc/internal/vibelangfuzz/` |
| Language proposals | VIP-0001 through VIP-0075 | `docs/design/vips/` |
| Published platform binaries | 6 (macOS, Linux, Windows on arm64 and x64) | `scripts/release/build-binaries.sh` |
| Published npm packages | 12 tarballs + VS Code VSIX | `scripts/release/make-packages.mjs` |
