import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_REMOTE_REF = "main@github";

function readJson(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  return { ...env, ...extra };
}

function runShell(command, cwd, env, logFile) {
  const result = spawnSync("sh", ["-c", command], {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 25 * 60_000
  });
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (logFile) {
    mkdirSync(path.dirname(logFile), { recursive: true });
    writeFileSync(logFile, combined, "utf8");
  }
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", combined };
}

function readCredentials(credentialsPath) {
  if (!credentialsPath) {
    throw new Error("site-deploy: missing credentials path (set credentials in payload or SITE_DEPLOY_CREDENTIALS)");
  }
  if (!existsSync(credentialsPath)) {
    throw new Error(`site-deploy: credentials file not found: ${credentialsPath}`);
  }
  const lines = readFileSync(credentialsPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("site-deploy: credentials file must contain CLOUDFLARE_API_TOKEN on line 1 and CLOUDFLARE_ACCOUNT_ID on line 2");
  }
  return { CLOUDFLARE_API_TOKEN: lines[0], CLOUDFLARE_ACCOUNT_ID: lines[1] };
}

export function start(state, options = {}) {
  mkdirSync(state, { recursive: true });
  mkdirSync(path.join(state, "logs"), { recursive: true });
  const config = {
    state,
    repo: options.repo || process.cwd(),
    revision: options.revision || DEFAULT_REMOTE_REF,
    credentials: options.credentials || process.env.SITE_DEPLOY_CREDENTIALS || "",
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    workspaceName: options.workspaceName || "site-deploy",
    mainCmd: options.mainCmd || process.env.SITE_DEPLOY_MAIN_CMD || "",
    npmCmd: options.npmCmd || process.env.SITE_DEPLOY_NPM_CMD || "",
    checkoutCmd: options.checkoutCmd || process.env.SITE_DEPLOY_CHECKOUT_CMD || "",
    regenerateCmd: options.regenerateCmd || process.env.SITE_DEPLOY_REGENERATE_CMD || "",
    deployCmd: options.deployCmd || process.env.SITE_DEPLOY_CMD || ""
  };
  writeJsonAtomic(path.join(state, "config.json"), config);
  return config;
}

function loadConfig(state) {
  const config = readJson(path.join(state, "config.json"));
  if (!config) throw new Error(`site-deploy: missing config.json in ${state}`);
  return config;
}

function loadCurrent(state) {
  const current = readJson(path.join(state, "current.json"));
  if (!current) throw new Error(`site-deploy: missing current.json in ${state}`);
  return current;
}

export function check(state) {
  const config = loadConfig(state);
  const env = cleanEnv();

  const mainCmd = config.mainCmd || `jj --ignore-working-copy -R ${JSON.stringify(config.repo)} log --no-graph -r ${JSON.stringify(config.revision)} -T commit_id`;
  const mainRes = runShell(mainCmd, config.repo, env, path.join(state, "logs/check-main.log"));
  const main = mainRes.stdout.trim().split(/\s+/)[0] || "";
  if (mainRes.status !== 0 || !main) {
    throw new Error(`site-deploy: unable to resolve ${config.revision}: ${mainRes.combined.trim() || `exit ${mainRes.status}`}`);
  }

  const npmCmd = config.npmCmd || "npm view vibelang version";
  const npmRes = runShell(npmCmd, config.repo, env, path.join(state, "logs/check-npm.log"));
  const npm = npmRes.stdout.trim().split(/\s+/)[0] || "";
  if (npmRes.status !== 0 || !npm) {
    throw new Error(`site-deploy: unable to resolve published npm version: ${npmRes.combined.trim() || `exit ${npmRes.status}`}`);
  }

  const previous = readJson(path.join(state, "deployed.json"));
  const changed = config.force || !previous || previous.main !== main || previous.npm !== npm;
  const skipped = !changed;
  const current = {
    main,
    npm,
    previous,
    changed,
    skipped,
    dryRun: config.dryRun,
    workspace: path.join(state, "ws")
  };
  writeJsonAtomic(path.join(state, "current.json"), current);
  const shortMain = main.slice(0, 12);
  const summary = skipped
    ? `unchanged at main ${shortMain} npm ${npm}; skipping deploy`
    : `change detected: main ${shortMain} npm ${npm} (previous ${previous ? `${previous.main.slice(0, 12)}/${previous.npm}` : "none"})`;
  return { ok: true, skipped, changed, main, npm, summary };
}

export function checkout(state) {
  const config = loadConfig(state);
  const current = loadCurrent(state);
  if (current.skipped) {
    return { ok: true, skipped: true, summary: "unchanged; skipped checkout" };
  }
  const ws = current.workspace;
  const env = cleanEnv({ SITE_DEPLOY_MAIN: current.main, SITE_DEPLOY_WS: ws, SITE_DEPLOY_REPO: config.repo });
  const cmd = config.checkoutCmd || (existsSync(ws)
    ? `cd ${JSON.stringify(ws)} && jj --no-pager workspace update-stale >/dev/null 2>&1 || true; cd ${JSON.stringify(ws)} && jj --no-pager new ${JSON.stringify(current.main)}`
    : `jj --no-pager -R ${JSON.stringify(config.repo)} workspace add ${JSON.stringify(ws)} --name ${JSON.stringify(config.workspaceName)} -r ${JSON.stringify(current.main)}`);
  const res = runShell(cmd, config.repo, env, path.join(state, "logs/checkout.log"));
  if (res.status !== 0) {
    throw new Error(`site-deploy: checkout failed (exit ${res.status}): ${res.combined.trim().slice(-400)}`);
  }
  return { ok: true, skipped: false, summary: `checked out ${current.main.slice(0, 12)} in ${ws}` };
}

export function regenerate(state) {
  const config = loadConfig(state);
  const current = loadCurrent(state);
  if (current.skipped) {
    return { ok: true, skipped: true, summary: "unchanged; skipped regenerate" };
  }
  const cwd = existsSync(current.workspace) ? current.workspace : config.repo;
  const env = cleanEnv({ SITE_DEPLOY_MAIN: current.main, SITE_DEPLOY_NPM: current.npm });
  const cmd = config.regenerateCmd || "cd .smithers && bun run docs:generate";
  const res = runShell(cmd, cwd, env, path.join(state, "logs/regenerate.log"));
  if (res.status !== 0) {
    throw new Error(`site-deploy: regenerate failed (exit ${res.status}): ${res.combined.trim().slice(-400)}`);
  }
  return { ok: true, skipped: false, summary: `regenerated docs for ${current.main.slice(0, 12)}` };
}

export function deploy(state) {
  const config = loadConfig(state);
  const current = loadCurrent(state);
  if (current.skipped) {
    return { ok: true, skipped: true, summary: "unchanged; skipped deploy" };
  }
  const cwd = existsSync(current.workspace) ? current.workspace : config.repo;
  const creds = current.dryRun ? {} : readCredentials(config.credentials);
  const env = cleanEnv({
    ...creds,
    SITE_DEPLOY_MAIN: current.main,
    SITE_DEPLOY_NPM: current.npm,
    SITE_DEPLOY_DRY_RUN: current.dryRun ? "1" : "0",
    VIBELANG_SKIP_RELEASE_SNIPPETS: "1",
    VIBELANG_SKIP_RELEASE_SNIPPETS_REASON: "scheduled site-deploy of main; docs are validated when they land"
  });
  const defaultCmd = current.dryRun ? "sh scripts/deploy-docs.sh --dry-run" : "sh scripts/deploy-docs.sh";
  const cmd = config.deployCmd || defaultCmd;
  const res = runShell(cmd, cwd, env, path.join(state, "logs/deploy.log"));
  if (res.status !== 0) {
    throw new Error(`site-deploy: deploy failed (exit ${res.status}): ${res.combined.trim().slice(-400)}`);
  }
  return {
    ok: true,
    skipped: false,
    summary: current.dryRun
      ? `dry-run deploy succeeded for main ${current.main.slice(0, 12)} npm ${current.npm}`
      : `deployed main ${current.main.slice(0, 12)} npm ${current.npm}`
  };
}

export function record(state) {
  const current = loadCurrent(state);
  const shortMain = current.main.slice(0, 12);
  if (current.skipped) {
    return { ok: true, skipped: true, summary: `unchanged at main ${shortMain} npm ${current.npm}; nothing recorded` };
  }
  if (current.dryRun) {
    return { ok: true, skipped: false, summary: `dry run of main ${shortMain} npm ${current.npm}; nothing recorded` };
  }
  writeJsonAtomic(path.join(state, "deployed.json"), {
    main: current.main,
    npm: current.npm,
    deployedAt: new Date().toISOString()
  });
  return { ok: true, skipped: false, summary: `recorded deploy of main ${shortMain} npm ${current.npm}` };
}

export const run = { check, checkout, regenerate, deploy, record };
