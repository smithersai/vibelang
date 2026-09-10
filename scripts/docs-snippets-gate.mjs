#!/usr/bin/env node
// Docs-snippet gate: every code block the documentation presents as a complete
// program must actually compile with the shipped compiler.
//
// Convention. A fenced block whose title is a file name — the Vocs title syntax,
// ```ts [main.vibe] — is a complete file. Blocks under the same heading form one
// project (so a `.vibe` file can import a sibling `.ts` adapter shown beside it,
// and a `tsconfig.json` block applies to that project). Blocks without a file
// name are fragments and are not checked. A file block that documents a refusal
// says so in its title: ```ts [broken.vibe] expect=refuse — then the gate
// requires at least one VIBE diagnostic instead of a clean check.
// `plan=<id>` selects the actual default `vibe plan` command with sibling
// input.json and providers.json files. `legacy-body` explicitly identifies a
// historical body example still checked through the legacy `check` pipeline.
//
// This gate exists because the landing page shipped a hero program that the
// compiler refused, and the getting-started page told readers to run `init`
// into a project the checker then rejected. Neither was visible to any test.
//
//   node scripts/docs-snippets-gate.mjs            # check every page
//   node scripts/docs-snippets-gate.mjs --verbose  # list every program
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getNativeCompiler } from "../poc/dist/compiler/native.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pagesRoot = join(root, "docs", "src", "pages");
const cli = join(root, "bin", "vibe.js");
const verbose = process.argv.includes("--verbose");

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

/** Extract file-titled code blocks, grouped by the nearest heading above them. */
export function extractProjects(markdown, page) {
  const projects = new Map();
  const lines = markdown.split("\n");
  let heading = "(top)";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = /^#{1,6}\s+(.+)$/u.exec(line);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      continue;
    }
    const fence = /^(\s*)(`{3,}|~{3,})(.*)$/u.exec(line);
    if (!fence) continue;
    const [, indent, marker, info] = fence;
    const titled = /^\s*\w+\s+\[([^\]]+)\](.*)$/u.exec(info);
    const closing = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`, "u");
    const body = [];
    index += 1;
    while (index < lines.length && !closing.test(lines[index])) {
      body.push(lines[index].startsWith(indent) ? lines[index].slice(indent.length) : lines[index]);
      index += 1;
    }
    if (index === lines.length) throw new Error(`${page}: unterminated code fence ${info.trim()}`);
    if (!titled) {
      if (/^\s*\w+\s+\[/u.test(info)) throw new Error(`${page}: malformed file title ${info.trim()}`);
      continue;
    }
    const [, title, meta] = titled;
    const fileName = title.trim();
    if (!/\.(vibe|ts|json)$/u.test(fileName)) continue;
    if (posix.normalize(fileName) !== fileName || posix.isAbsolute(fileName) || fileName.startsWith("../") ||
      /[\\:\0]/u.test(fileName) || fileName.split("/").includes("node_modules")) {
      throw new Error(`${page}: file block must have a contained portable path: ${fileName}`);
    }
    const tokens = meta.trim().split(/\s+/u).filter(Boolean);
    if (tokens.some(token => token !== "expect=refuse" && token !== "legacy-body" && !/^plan=\S+$/u.test(token)) ||
      new Set(tokens).size !== tokens.length || tokens.filter(token => token.startsWith("plan=")).length > 1) {
      throw new Error(`${page}: unknown or duplicate file metadata: ${meta.trim()}`);
    }
    if (tokens.length > 0 && !fileName.endsWith(".vibe")) throw new Error(`${page}: program metadata requires a .vibe entry`);
    const key = `${page}#${heading}`;
    if (!projects.has(key)) projects.set(key, { page, heading, files: new Map(), expectRefuse: new Set(), plans: new Map(), legacyBodies: new Set() });
    const project = projects.get(key);
    if (project.files.has(fileName)) {
      throw new Error(`${relative(root, page)} §${heading}: file block ${fileName} appears twice under one heading`);
    }
    project.files.set(fileName, `${body.join("\n")}\n`);
    if (tokens.includes("expect=refuse")) project.expectRefuse.add(fileName);
    if (tokens.includes("legacy-body")) project.legacyBodies.add(fileName);
    const plan = tokens.find(token => token.startsWith("plan="));
    if (plan) project.plans.set(fileName, plan.slice(5));
  }
  for (const project of projects.values()) {
    if (project.plans.size > 1 || (project.plans.size && project.legacyBodies.size)) {
      throw new Error(`${page} §${project.heading}: one keyed Plan entry cannot be mixed with another Plan or legacy-body entry`);
    }
    if (project.plans.size && (!project.files.has("input.json") || !project.files.has("providers.json"))) {
      throw new Error(`${page} §${project.heading}: keyed Plan examples require input.json and providers.json`);
    }
    if (project.plans.size && project.files.has("tsconfig.json")) {
      throw new Error(`${page} §${project.heading}: plan does not consume tsconfig.json`);
    }
  }
  return [...projects.values()];
}

export function projectInvocation(project) {
  if (project.plans.size) {
    const [entry, planId] = [...project.plans][0];
    return { mode: "keyed", files: [entry], planId, args: ["plan", entry,
      "--input", "input.json", "--providers", "providers.json", "--planId", planId, "--format", "json"] };
  }
  const files = [...project.files.keys()].filter(name => name.endsWith(".vibe"));
  const args = ["check", ...files, "--format", "json"];
  if (project.files.has("tsconfig.json")) args.push("-p", "tsconfig.json");
  return { mode: project.legacyBodies.size ? "legacy-body" : "check", files, args };
}

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const matchesFile = (path, name) => typeof path === "string" && (path === name || path.replaceAll("\\", "/").endsWith(`/${name}`));
const diagnostics = value => Array.isArray(value) && value.every(issue => record(issue) && typeof issue.code === "string" && typeof issue.message === "string");

/** A JSON envelope is not evidence of success. Check process status, profile,
 * every expected file, and (for Plans) the native graph verifier independently. */
export function assessInvocation(project, invocation, result, verifyPlan) {
  const fail = message => [message];
  if (result.error || result.signal != null || ![0, 1].includes(result.status)) {
    return fail(`compiler process failed: ${result.error?.message ?? result.signal ?? result.status}`);
  }
  let report;
  try { report = JSON.parse(result.stdout); } catch { return fail("compiler produced invalid JSON"); }
  if (!record(report) || typeof report.ok !== "boolean" || report.ok !== (result.status === 0)) {
    return fail("compiler status and result envelope do not agree");
  }
  if (invocation.mode === "keyed") {
    const entry = invocation.files[0];
    if (report.profile !== "keyed" || !matchesFile(report.file, entry) || "manifest" in report) {
      return fail("expected a keyed Plan report for the declared entry, never a Manifest fallback");
    }
    if (project.expectRefuse.has(entry)) {
      return !report.ok && !("plan" in report) && !("artifact" in report) && diagnostics(report.diagnostics) &&
        report.diagnostics.some(issue => issue.code.startsWith("VIBE") && issue.category === "error")
        ? [] : fail("documented Plan refusal did not produce native source diagnostics without an artifact");
    }
    if (!report.ok || !record(report.plan) || report.plan.planId !== invocation.planId ||
      report.planId !== invocation.planId || report.digest !== report.plan.digest || !Array.isArray(report.plan.nodes)) {
      return fail("documented Plan did not compile with its declared identity");
    }
    if (report.diagnostics !== undefined && (!diagnostics(report.diagnostics) || report.diagnostics.length > 0)) {
      return fail("a successful Plan report contains diagnostics");
    }
    if (typeof verifyPlan !== "function") return fail("Plan verification is unavailable");
    try {
      const bytes = JSON.stringify(report.plan), verified = verifyPlan(bytes);
      if (verified.ok !== true || verified.planJson !== bytes) return fail("native Plan verification refused the published graph");
    } catch (error) { return fail(`native Plan verification failed: ${String(error)}`); }
    return [];
  }
  if (!Array.isArray(report.files) || report.files.some(file => !record(file) || typeof file.input !== "string" || !diagnostics(file.diagnostics))) {
    return fail("compiler omitted or malformed its file reports");
  }
  if (!report.ok && !invocation.files.some(name => project.expectRefuse.has(name))) {
    return fail("a documented successful project was refused");
  }
  const failures = [];
  for (const name of invocation.files) {
    const matches = report.files.filter(file => matchesFile(file.input, name));
    if (matches.length !== 1) { failures.push(`expected exactly one file report for ${name}`); continue; }
    const codes = matches[0].diagnostics.map(issue => `${issue.code} ${issue.message}`);
    if (project.expectRefuse.has(name)) {
      if (report.ok || !codes.some(code => code.startsWith("VIBE"))) failures.push(`${name}: documented refusal was not measured`);
    } else if (codes.length > 0 || !report.ok) {
      failures.push(`${name}: documented successful file was not checked successfully: ${codes.join("; ")}`);
    }
  }
  return failures;
}

export function runDocsGate() {
  const failures = [], counts = {check: 0, keyed: 0, "legacy-body": 0};
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-docs-snippets-"));
  try {
    for (const page of walk(pagesRoot).sort()) {
      for (const project of extractProjects(readFileSync(page, "utf8"), page)) {
        const invocation = projectInvocation(project);
        if (invocation.files.length === 0) continue;
        counts[invocation.mode] += invocation.files.length;
        const label = `${relative(root, project.page)} §${project.heading}`;
        const directory = mkdtempSync(join(scratch, "p-"));
        mkdirSync(join(directory, "node_modules"));
        symlinkSync(root, join(directory, "node_modules", "vibelang"), "dir");
        for (const [name, text] of project.files) {
          mkdirSync(dirname(join(directory, name)), {recursive: true});
          writeFileSync(join(directory, name), text, {flag: "wx"});
        }
        const result = spawnSync(process.execPath, [cli, ...invocation.args],
          {cwd: directory, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024});
        const measured = assessInvocation(project, invocation, result,
          inputJson => getNativeCompiler().keyedPlan({operation: "verify", inputJson}));
        failures.push(...measured.map(message => `${label}: ${message}\n${result.stderr || ""}`));
        if (verbose && measured.length === 0) process.stdout.write(`ok [${invocation.mode}] ${label}\n`);
      }
    }
  } catch (error) { failures.push(String(error)); }
  finally { rmSync(scratch, {recursive: true, force: true}); }
  const checked = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (failures.length > 0) {
    process.stderr.write(`docs-snippets-gate: ${failures.length} failing program(s) of ${checked}\n\n${failures.join("\n\n")}\n`);
    return 1;
  }
  process.stdout.write(`docs-snippets-gate: ok (${checked} documented programs compile as written)\n`);
  process.stdout.write(`docs-snippets profiles: ${JSON.stringify(counts)}\n`);
  return 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = runDocsGate();
}
