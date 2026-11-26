import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

export function extractSignature(target, logText) {
  const lines = String(logText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sig = lines.find((line) => /^(?:panic:|hang:|fatal error:|--- FAIL:|FAIL:)/.test(line))
    ?? lines.find((line) => /panic:|hang:|Failing input|error:/i.test(line))
    ?? "";
  return sig.replace(/\b0x[0-9a-f]+\b/gi, "0xADDR").slice(0, 200);
}

export function failureKey(target, signature, inputBytes) {
  const hash = createHash("sha256");
  hash.update(String(target));
  hash.update("\0");
  if (signature) {
    hash.update("sig:");
    hash.update(signature);
  } else {
    hash.update("bytes:");
    hash.update(inputBytes ?? Buffer.alloc(0));
  }
  return hash.digest("hex").slice(0, 16);
}

export function collectLocalCrashers(crashersRoot, logsDir) {
  if (!existsSync(crashersRoot)) return [];
  const results = [];
  for (const target of readdirSync(crashersRoot).sort()) {
    const targetDir = path.join(crashersRoot, target);
    if (!statSync(targetDir).isDirectory()) continue;
    const logPath = path.join(logsDir, `${target}.log`);
    const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    const sig = extractSignature(target, logText);
    for (const file of readdirSync(targetDir).sort()) {
      const fullPath = path.join(targetDir, file);
      if (!statSync(fullPath).isFile()) continue;
      const bytes = readFileSync(fullPath);
      const key = failureKey(target, sig, bytes);
      results.push({
        id: `${target}/${file}`,
        target,
        file,
        localPath: fullPath,
        failureKey: key,
        signature: sig,
        excerpt: logText.trim().slice(-600),
        size: bytes.length
      });
    }
  }
  return results;
}

export function classifyCampaignResult({ exitCode, summaryText, logText, crashers }) {
  if (crashers.length > 0) {
    return { ok: true, crashers };
  }
  if (exitCode === 0) {
    return { ok: true, crashers: [] };
  }
  const hasFuzzSummary = /\bFuzz\w+\s+\S+\s+(?:exit|timed out|retired)/.test(summaryText || "");
  if (hasFuzzSummary) {
    // Campaign ran targets, exited non-zero without emitting new crashers
    // (e.g. a seed failure or timeout in summary.txt). Surface clearly as failure.
    const detail = (summaryText || logText || "").trim().slice(-800);
    throw new Error(`fuzz-campaign: campaign exited ${exitCode} without crashers:\n${detail}`);
  }
  const detail = (logText || summaryText || "").trim().slice(-800);
  throw new Error(`fuzz-campaign: campaign broke before fuzzing (exit ${exitCode}):\n${detail}`);
}

export function fileFinding(findingsDir, crasher) {
  mkdirSync(findingsDir, { recursive: true });
  const indexPath = path.join(findingsDir, "index.json");
  const dupPath = path.join(findingsDir, "duplicates.json");
  const index = readJson(indexPath, {});
  const duplicates = readJson(dupPath, []);

  const existing = index[crasher.failureKey];
  if (existing && existsSync(path.join(findingsDir, existing.file))) {
    const dupRecord = {
      status: "duplicate",
      failureKey: crasher.failureKey,
      duplicateOf: existing.id,
      crasher: crasher.id,
      target: crasher.target,
      localPath: crasher.localPath,
      recordedAt: new Date().toISOString()
    };
    duplicates.push(dupRecord);
    writeJsonAtomic(dupPath, duplicates);
    return dupRecord;
  }

  const findingId = `finding-${crasher.target}-${crasher.failureKey}`;
  const fileName = `${findingId}.md`;
  const findingPath = path.join(findingsDir, fileName);
  const body = [
    `# ${crasher.target} (${crasher.failureKey})`,
    "",
    `- Target: \`${crasher.target}\``,
    `- Failure key: \`${crasher.failureKey}\``,
    `- Crasher: \`${crasher.id}\` (${crasher.size} bytes)`,
    `- Saved copy: \`${crasher.localPath}\``,
    crasher.signature ? `- Signature: \`${crasher.signature}\`` : "- Signature: (input-hash)",
    "",
    "## Log excerpt",
    "",
    "```text",
    crasher.excerpt || "(no target log excerpt)",
    "```",
    ""
  ].join("\n");
  writeFileSync(findingPath, body, "utf8");

  const entry = {
    id: findingId,
    file: fileName,
    failureKey: crasher.failureKey,
    target: crasher.target,
    crasher: crasher.id,
    signature: crasher.signature,
    filedAt: new Date().toISOString()
  };
  index[crasher.failureKey] = entry;
  writeJsonAtomic(indexPath, index);
  return { status: "filed", ...entry };
}

export function verifyCrashers(findingsDir, crashers) {
  const index = readJson(path.join(findingsDir, "index.json"), {});
  const missing = [];
  for (const crasher of crashers) {
    const entry = index[crasher.failureKey];
    if (!entry || !existsSync(path.join(findingsDir, entry.file))) {
      missing.push(crasher);
    }
  }
  return {
    resolved: missing.length === 0,
    total: crashers.length,
    recorded: crashers.length - missing.length,
    missing
  };
}

export function writeReport(runDir, report) {
  writeJsonAtomic(path.join(runDir, "report.json"), report);
}
