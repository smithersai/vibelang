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
print("vibe/vibex filetypes, parsers and LSP attachment passed")
vim.cmd("qa!")
