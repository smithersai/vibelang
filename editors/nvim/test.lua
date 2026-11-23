-- Headless check of vibelang.lua, run by editors/nvim/test.sh on a copy of
-- typescript/vibelang/lsp-fixture whose node_modules/.bin/vibelang is the
-- compiler under test:
--
--   nvim --headless --clean -l editors/nvim/test.lua <project> <vibelang.lua> <runtime> [nvim-treesitter]
--
-- <runtime> holds parser/vibe.so, the vibe parser compiled from
-- editors/tree-sitter-vibelang. With "fallback" in its place, there is no vibe
-- parser, and only the fallback to TypeScript is checked. nvim-treesitter, when
-- given, supplies the TypeScript queries that the vibe queries inherit, and
-- :TSInstall vibe is checked into a scratch directory.
local project, config, runtime, nvim_treesitter = arg[1], arg[2], arg[3], arg[4] or ""
local fallback = runtime == "fallback"
if not fallback then
  vim.opt.runtimepath:prepend(runtime)
end
if nvim_treesitter ~= "" then
  vim.opt.runtimepath:append(nvim_treesitter)
end
vim.cmd("filetype on")
dofile(config).setup()

local failures = 0
local function check(name, body)
  local ok, err = pcall(body)
  if ok then
    io.stdout:write("ok   " .. name .. "\n")
  else
    failures = failures + 1
    io.stdout:write("FAIL " .. name .. ": " .. tostring(err) .. "\n")
  end
end

local function edit(relative)
  vim.cmd.edit(vim.fs.joinpath(project, relative))
  return vim.api.nvim_get_current_buf()
end

local function wait_for(what, predicate)
  if not vim.wait(90000, predicate, 100) then
    error("timed out waiting for " .. what)
  end
end

local function client_of(buf)
  wait_for("vibelang to attach", function()
    return #vim.lsp.get_clients({ bufnr = buf, name = "vibelang" }) > 0
  end)
  return vim.lsp.get_clients({ bufnr = buf, name = "vibelang" })[1]
end

local function has_diagnostic(buf, code, source)
  for _, d in ipairs(vim.diagnostic.get(buf)) do
    if d.code == code and (source == nil or d.source == source) then
      return true
    end
  end
  return false
end

local function position_of(buf, needle)
  for row, line in ipairs(vim.api.nvim_buf_get_lines(buf, 0, -1, false)) do
    local col = line:find(needle, 1, true)
    if col then
      return { line = row - 1, character = col - 1 }
    end
  end
  error("no " .. needle)
end

-- finish stops the language servers and exits with the result.
local function finish()
  for _, client in ipairs(vim.lsp.get_clients()) do
    client.stop()
  end
  vim.wait(5000, function()
    return #vim.lsp.get_clients() == 0
  end)
  os.exit(failures > 0 and 1 or 0)
end

if fallback then
  check("filetype: without the vibe parser, .vibe files are highlighted as TypeScript", function()
    local buf = edit("src/broken.vibe")
    assert(vim.bo[buf].filetype == "vibe", "filetype " .. vim.bo[buf].filetype)
    assert(vim.treesitter.language.get_lang("vibe") == "typescript", "language " .. tostring(vim.treesitter.language.get_lang("vibe")))
    assert(vim.bo[buf].syntax == "typescript" or vim.treesitter.highlighter.active[buf], "no highlighting")
  end)
  finish()
end

check("filetype: .vibe files are vibe, highlighted by the vibe parser", function()
  local buf = edit("src/broken.vibe")
  assert(vim.bo[buf].filetype == "vibe", "filetype " .. vim.bo[buf].filetype)
  assert(vim.treesitter.highlighter.active[buf], "no tree-sitter highlighting")
  assert(vim.treesitter.get_parser(buf):lang() == "vibe", "parser " .. vim.treesitter.get_parser(buf):lang())
end)

check("lsp: the project's node_modules/.bin/vibelang attaches", function()
  local client = client_of(vim.api.nvim_get_current_buf())
  local cmd = client.config.cmd[1]
  assert(cmd:sub(-#"node_modules/.bin/vibelang") == "node_modules/.bin/vibelang", "command " .. cmd)
end)

check("diagnostics: TS2322 on broken.vibe", function()
  local buf = vim.api.nvim_get_current_buf()
  wait_for("TS2322", function()
    return has_diagnostic(buf, 2322)
  end)
end)

check("diagnostics: EK0102 with source EK on old-await.vibe", function()
  local buf = edit("src/old-await.vibe")
  wait_for("EK0102", function()
    return has_diagnostic(buf, 102, "EK")
  end)
end)

check("hover: a call that runs shows the contract and the success value", function()
  local buf = edit("src/main.vibe")
  client_of(buf)
  local params = { textDocument = vim.lsp.util.make_text_document_params(buf), position = position_of(buf, "lookup(1)") }
  local text = ""
  for _, response in pairs(vim.lsp.buf_request_sync(buf, "textDocument/hover", params, 30000) or {}) do
    local contents = response.result and response.result.contents
    if contents then
      text = text .. (contents.value or vim.inspect(contents))
    end
  end
  assert(text:find("string!NotFound!", 1, true), "hover " .. text)
  assert(text:find("Runs here and returns `string`", 1, true), "hover " .. text)
end)

-- quiet_lines returns a buffer highlighted by the vibe parser that holds
-- lines. It skips the FileType autocommands, so no language server starts for
-- it.
local function quiet_lines(lines)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  local eventignore = vim.o.eventignore
  vim.o.eventignore = "FileType"
  vim.bo[buf].filetype = "vibe"
  vim.o.eventignore = eventignore
  vim.treesitter.start(buf, "vibe")
  return buf
end

-- quiet_buffer returns a quiet_lines buffer that holds the fixture file
-- relative.
local function quiet_buffer(relative)
  return quiet_lines(vim.fn.readfile(vim.fs.joinpath(project, relative)))
end

-- capture_at returns the captures at offset bytes into the first occurrence
-- of needle, the last of which colors it.
local function capture_at(buf, needle, offset)
  local at = position_of(buf, needle)
  local names = {}
  for _, capture in ipairs(vim.treesitter.get_captures_at_pos(buf, at.line, at.character + offset)) do
    table.insert(names, capture.capture)
  end
  return names
end

-- assert_captures fails unless each { needle, offset, capture } of tokens is
-- colored by capture in buf.
local function assert_captures(buf, tokens)
  local wrong = {}
  for _, token in ipairs(tokens) do
    local names = capture_at(buf, token[1], token[2])
    if names[#names] ~= token[3] then
      table.insert(wrong, string.format("%s@%d: want %s, got %s", token[1], token[2], token[3], table.concat(names, " ")))
    end
  end
  assert(#wrong == 0, table.concat(wrong, "; "))
end

check("parse: fixture sources have their expected syntax", function()
  for name in vim.fs.dir(vim.fs.joinpath(project, "src")) do
    if name:match("%.vibe$") then
      local text = table.concat(vim.fn.readfile(vim.fs.joinpath(project, "src", name)), "\n")
      local root = vim.treesitter.get_string_parser(text, "vibe"):parse()[1]:root()
      if name == "malformed-pipe.vibe" or name == "old-catch.vibe" or name == "old-declarations.vibe" then
        -- malformed-pipe.vibe has no pipe operand; old-catch.vibe and old-declarations.vibe keep retired syntax.
        assert(root:has_error(), name .. " must retain its intentional parse error")
      else
        assert(not root:has_error(), name .. " has an ERROR or MISSING node")
      end
    end
  end
end)

-- Each VibeLang token of forms.vibe, and the capture that colors it.
local tokens = {
  { "export error Gone", 7, "keyword.type" },
  { "mutable items", 0, "keyword.modifier" },
  { "export schema", 7, "keyword.type" },
  { "export service", 7, "keyword.type" },
  { "string!Gone", 6, "operator" },
  { "boolean!!", 7, "operator" },
  { "boolean!!", 8, "operator" },
  { "export effect function admit", 7, "keyword.coroutine" },
  { "provide SeatsLive", 0, "keyword" },
  { "fork seats.take", 0, "keyword.coroutine" },
  { "join first", 0, "keyword.coroutine" },
  { "try.all [", 0, "keyword.exception" },
  { "try.all [", 4, "keyword.coroutine" },
  { "for concurrent", 4, "keyword.repeat" },
  { 'catch () => "guest"', 0, "keyword.exception" },
  { "catch (e) => match", 0, "keyword.exception" },
  { "match (e)", 0, "keyword.conditional" },
  { "when Gone", 0, "keyword.conditional" },
  { "?? throw", 3, "keyword.exception" },
  { "effect { try sleep", 0, "keyword.coroutine" },
  { "|> %", 0, "operator" },
  { "|> %", 3, "operator" },
  { "is Exit", 0, "keyword.operator" },
}

check("highlights: VibeLang's tokens get their captures", function()
  assert_captures(quiet_buffer("src/forms.vibe"), tokens)
end)

-- A module declaration and identifier module specifiers (D283). The body is
-- TypeScript that VibeLang outside it would read differently.
local module_lines = {
  "module text {",
  "  export async function read(path: string): Promise<string> {",
  "    try {",
  "      return await load(path)",
  "    } catch {",
  '      throw new Error("unreadable")',
  "    }",
  "  }",
  "}",
  "",
  "import { read } from text",
  "import text",
  "export * from text",
}

-- Each token of the module forms, and the capture that colors it.
local module_tokens = {
  { "module text", 0, "keyword" },
  { "module text", 7, "module" },
  { "from text", 5, "module" },
  { "import text", 7, "module" },
  { "* from text", 7, "module" },
}

check("highlights: a module declaration's tokens get their captures", function()
  local buf = quiet_lines(module_lines)
  assert(not vim.treesitter.get_parser(buf):parse()[1]:root():has_error(), "the module declaration has an ERROR or MISSING node")
  assert_captures(buf, module_tokens)
end)

if nvim_treesitter ~= "" then
  check("highlights: the vibe queries inherit nvim-treesitter's TypeScript queries", function()
    local buf = quiet_buffer("src/forms.vibe")
    local names = capture_at(buf, "Array<string>", 0)
    assert(vim.tbl_contains(names, "type"), "Array: " .. table.concat(names, " "))
    names = capture_at(buf, "export effect function admit", 0)
    assert(vim.tbl_contains(names, "keyword.import"), "export: " .. table.concat(names, " "))
    for _, query in ipairs({ "injections", "locals", "folds", "indents" }) do
      assert(vim.treesitter.query.get("vibe", query), "no " .. query .. " query")
    end
  end)

  -- TypeScript's captures in a module declaration's body, from the inherited
  -- TypeScript queries.
  local module_body_tokens = {
    { "async function", 0, "keyword.coroutine" },
    { "function read", 0, "keyword.function" },
    { "read(path", 0, "function" },
    { "path: string", 6, "type.builtin" },
    { "Promise<string>", 0, "type" },
    { "await load", 0, "keyword.coroutine" },
    { "try {", 0, "keyword.exception" },
    { "} catch", 2, "keyword.exception" },
    { "throw new", 0, "keyword.exception" },
  }

  check("highlights: TypeScript's queries color a module declaration's body", function()
    assert_captures(quiet_lines(module_lines), module_body_tokens)
  end)

  check("nvim-treesitter: :TSInstall vibe compiles the grammar", function()
    local dir = vim.fn.tempname()
    require("nvim-treesitter.configs").setup({ parser_install_dir = dir })
    require("nvim-treesitter.install").commands.TSInstallSync["run!"]("vibe")
    io.stdout:write("\n") -- after nvim-treesitter's message
    local installed = vim.fs.joinpath(dir, "parser", "vibe.so")
    assert(vim.uv.fs_stat(installed), "no " .. installed)
    vim.fn.delete(dir, "rf")
  end)
end

finish()
