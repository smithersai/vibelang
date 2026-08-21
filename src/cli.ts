import { Cli, z } from "incur";

import { resolveTypeScriptCompiler, runTypeScriptCompiler } from "./compiler-process.js";

const version = "0.0.1";

const files = z.object({
  files: z.array(z.string()).optional().describe("TypeScript source files"),
});

const compileOptions = z.object({
  project: z.string().optional().describe("Path to tsconfig.json or its directory"),
  target: z.string().optional().describe("JavaScript language target"),
  module: z.string().optional().describe("Generated module format"),
  moduleResolution: z.string().optional().describe("Module resolution strategy"),
  outDir: z.string().optional().describe("Output directory"),
  rootDir: z.string().optional().describe("Source root directory"),
  declaration: z.boolean().optional().describe("Generate declaration files"),
  declarationMap: z.boolean().optional().describe("Generate declaration source maps"),
  sourceMap: z.boolean().optional().describe("Generate JavaScript source maps"),
  noEmit: z.boolean().optional().describe("Type-check without emitting files"),
  strict: z.boolean().optional().describe("Enable strict type checking"),
  incremental: z.boolean().optional().describe("Save incremental build information"),
  watch: z.boolean().optional().describe("Watch input files"),
  pretty: z.boolean().optional().describe("Use color and context in diagnostics"),
  showConfig: z.boolean().optional().describe("Print resolved configuration"),
  listFilesOnly: z.boolean().optional().describe("Print inputs without compiling"),
});

type CompileOptions = z.infer<typeof compileOptions>;

function compilerArgs(inputFiles: readonly string[] | undefined, options: CompileOptions): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined || value === false) continue;
    args.push(`--${name}`);
    if (value !== true) args.push(String(value));
  }
  if (inputFiles) args.push(...inputFiles);
  return args;
}

function finishCompiler(status: number): undefined {
  if (status !== 0) process.exitCode = status;
  return undefined;
}

const cli = Cli.create("vibe", {
  version,
  description: "The VibeLang toolchain (initial compatibility shell)",
})
  .command("compile", {
    args: files,
    options: compileOptions,
    alias: { project: "p", watch: "w" },
    description: "Compile TypeScript-compatible input with the native TypeScript backend",
    hint: "Use vibec (or vtsc) when exact raw tsc argument compatibility is required.",
    run(context) {
      return finishCompiler(
        runTypeScriptCompiler(compilerArgs(context.args.files, context.options)),
      );
    },
  })
  .command("check", {
    args: files,
    options: compileOptions.omit({ noEmit: true }),
    alias: { project: "p", watch: "w" },
    description: "Type-check TypeScript-compatible input without emitting",
    run(context) {
      return finishCompiler(
        runTypeScriptCompiler([
          "--noEmit",
          ...compilerArgs(context.args.files, context.options),
        ]),
      );
    },
  })
  .command("build", {
    args: z.object({
      projects: z.array(z.string()).optional().describe("Projects to build"),
    }),
    options: z.object({
      clean: z.boolean().optional().describe("Delete build outputs"),
      dry: z.boolean().optional().describe("Show what would be built or deleted"),
      force: z.boolean().optional().describe("Build all projects"),
      verbose: z.boolean().optional().describe("Explain build decisions"),
      watch: z.boolean().optional().describe("Watch projects"),
    }),
    description: "Build project references using the native TypeScript backend",
    run(context) {
      const args = ["--build"];
      for (const [name, enabled] of Object.entries(context.options)) {
        if (enabled) args.push(`--${name}`);
      }
      if (context.args.projects) args.push(...context.args.projects);
      return finishCompiler(runTypeScriptCompiler(args));
    },
  })
  .command("init", {
    description: "Create a TypeScript-compatible tsconfig.json",
    run() {
      return finishCompiler(runTypeScriptCompiler(["--init"]));
    },
  })
  .command("format", {
    args: files,
    description: "Format VibeLang and TypeScript sources",
    run(context) {
      return context.error({
        code: "NOT_IMPLEMENTED",
        exitCode: 2,
        message: "vibe format is not implemented in M0",
      });
    },
  })
  .command("test", {
    args: files,
    description: "Run VibeLang tests",
    run(context) {
      return context.error({
        code: "NOT_IMPLEMENTED",
        exitCode: 2,
        message: "vibe test is not implemented in M0",
      });
    },
  })
  .command("lsp", {
    description: "Start the VibeLang language server",
    run(context) {
      return context.error({
        code: "NOT_IMPLEMENTED",
        exitCode: 2,
        message: "vibe lsp is not implemented; use the pass-through TypeScript plugin for now",
      });
    },
  })
  .command("doctor", {
    description: "Inspect the installed compatibility backends",
    run() {
      return {
        vibelang: version,
        nativeCompiler: resolveTypeScriptCompiler(),
        nativeTypeScript: "7.x",
        javascriptApi: "TypeScript 5.9.x",
        vibeSyntax: "not implemented",
        languageServer: "not implemented",
      };
    },
  });

await cli.serve();

