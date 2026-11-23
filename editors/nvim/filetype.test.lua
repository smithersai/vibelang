-- Grammar/filetype regression without the compiler or a running language server.
local config, runtime = arg[1], arg[2]
if runtime then vim.opt.runtimepath:prepend(runtime) end
if not runtime then vim.treesitter.language.add = function() error("no installed parser") end end
local starts = {}
vim.lsp.start = function(options, args) starts[args.bufnr] = options end
vim.cmd("filetype on")
dofile(config).setup()
for _, extension in ipairs({ "vibex", "vibe" }) do
  vim.cmd("enew")
  vim.cmd("file view." .. extension)
  vim.cmd("filetype detect")
  assert(vim.bo.filetype == extension, extension .. ": " .. vim.bo.filetype)
  assert(starts[vim.api.nvim_get_current_buf()], extension .. ": LSP not attached")
  local fallback = extension == "vibex" and "tsx" or "typescript"
  local expected = runtime and extension or fallback
  assert(vim.treesitter.language.get_lang(extension) == expected, extension .. ": wrong parser")
  if runtime then
    local code = extension == "vibex"
      and "const v = <catch.Box task={effect { return try load(); }}>{value |> f(%)}</catch.Box>"
      or "const v = effect { return try load(); }; const p = value |> f(%)"
    vim.api.nvim_buf_set_lines(0, 0, -1, false, { code })

    assert(not vim.treesitter.get_parser(0):parse()[1]:root():has_error(), extension .. ": invalid tree")
    for word, capture in pairs({ effect = "keyword.coroutine", try = "keyword.exception", ["|>"] = "operator", ["%"] = "operator" }) do
      local names = {}
      for _, hit in ipairs(vim.treesitter.get_captures_at_pos(0, 0, code:find(word, 1, true) - 1)) do
        table.insert(names, hit.capture)
      end
      assert(vim.tbl_contains(names, capture), extension .. ": " .. word .. " lacks " .. capture)
    end
    if extension == "vibex" then
      for _, hit in ipairs(vim.treesitter.get_captures_at_pos(0, 0, code:find("catch", 1, true) - 1)) do
        assert(hit.capture ~= "keyword.exception", "a JSX member name is not catch code")
      end
      local text = "const v = <p>effect try % !</p>"
      vim.api.nvim_buf_set_lines(0, 0, -1, false, { text })
      for _, word in ipairs({ "effect", "try", "%" }) do
        for _, hit in ipairs(vim.treesitter.get_captures_at_pos(0, 0, text:find(word, 1, true) - 1)) do
          assert(not vim.tbl_contains({ "keyword.coroutine", "keyword.exception", "operator" }, hit.capture),
            "VibeLang keyword in JSX text: " .. word)
        end
      end
    end
  else
    assert(vim.bo.syntax == (extension == "vibex" and "typescriptreact" or "typescript"), extension .. ": wrong fallback syntax")
  end
end
-- Monorepo hoisted compiler discovery (#571): nested package has its own tsconfig.json
-- while node_modules/.bin/vibelang lives in an ancestor workspace directory.
do
  local root = vim.fn.tempname()
  local bin_dir = vim.fs.joinpath(root, "node_modules", ".bin")
  local pkg_src = vim.fs.joinpath(root, "packages", "app", "src")
  vim.fn.mkdir(bin_dir, "p")
  vim.fn.mkdir(pkg_src, "p")
  local hoisted = vim.fs.joinpath(bin_dir, "vibelang")
  vim.fn.writefile({ "#!/bin/sh", "exit 0" }, hoisted)
  vim.fn.setfperm(hoisted, "rwxr-xr-x")
  vim.fn.writefile({ "{}" }, vim.fs.joinpath(root, "packages", "app", "tsconfig.json"))
  local nested_file = vim.fs.joinpath(pkg_src, "main.vibe")
  vim.fn.writefile({ "export const n = 1" }, nested_file)
  vim.cmd("enew")
  vim.cmd("file " .. vim.fn.fnameescape(nested_file))
  vim.cmd("filetype detect")
  local started = starts[vim.api.nvim_get_current_buf()]
  local expected = vim.uv.fs_realpath(hoisted) or hoisted
  local got = started and (vim.uv.fs_realpath(started.cmd[1]) or started.cmd[1]) or nil
  vim.fn.delete(root, "rf")
  assert(started, "monorepo nested file: LSP not attached")
  assert(got == expected, "expected hoisted compiler " .. expected .. ", got " .. tostring(got))
end

print("vibe/vibex filetypes, parsers and LSP attachment passed")
vim.cmd("qa!")
