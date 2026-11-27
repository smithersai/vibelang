use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result, Worktree};

struct VibeExtension;

impl VibeExtension {
    fn default_args() -> Vec<String> {
        vec!["--lsp".to_string(), "--stdio".to_string()]
    }

    fn workspace_binary(worktree: &Worktree) -> Option<(String, Option<Vec<String>>)> {
        let root = worktree.root_path();
        let (os, _arch) = zed::current_platform();

        match os {
            zed::Os::Windows => {
                if worktree
                    .read_text_file("node_modules/vibelang/bin/vibelang")
                    .is_ok()
                {
                    if let Ok(node) = zed::node_binary_path() {
                        return Some((
                            node,
                            Some(vec![
                                format!("{root}/node_modules/vibelang/bin/vibelang"),
                                "--lsp".to_string(),
                                "--stdio".to_string(),
                            ]),
                        ));
                    }
                }
                for rel in [
                    "node_modules/.bin/vibelang.cmd",
                    "node_modules/.bin/vibe.cmd",
                ] {
                    if worktree.read_text_file(rel).is_ok() {
                        return Some((format!("{root}/{rel}"), None));
                    }
                }
            }
            zed::Os::Mac | zed::Os::Linux => {
                if worktree
                    .read_text_file("node_modules/.bin/vibelang")
                    .is_ok()
                    || worktree
                        .read_text_file("node_modules/vibelang/package.json")
                        .is_ok()
                {
                    return Some((format!("{root}/node_modules/.bin/vibelang"), None));
                }
                if worktree.read_text_file("node_modules/.bin/vibe").is_ok() {
                    return Some((format!("{root}/node_modules/.bin/vibe"), None));
                }
            }
        }

        None
    }
}

impl zed::Extension for VibeExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<zed::Command> {
        let lsp_settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree).ok();
        let binary_settings = lsp_settings.as_ref().and_then(|s| s.binary.as_ref());

        let mut env = worktree.shell_env();
        if let Some(extra_env) = binary_settings.and_then(|b| b.env.as_ref()) {
            for (key, value) in extra_env {
                env.push((key.clone(), value.clone()));
            }
        }

        let configured_args = binary_settings.and_then(|b| b.arguments.clone());

        if let Some(path) = binary_settings.and_then(|b| b.path.clone()) {
            return Ok(zed::Command {
                command: path,
                args: configured_args.unwrap_or_else(Self::default_args),
                env,
            });
        }

        if let Some((command, node_args)) = Self::workspace_binary(worktree) {
            let args = match (node_args, configured_args) {
                (Some(mut prefix), Some(extra)) => {
                    prefix.truncate(1);
                    prefix.extend(extra);
                    prefix
                }
                (Some(full), None) => full,
                (None, Some(custom)) => custom,
                (None, None) => Self::default_args(),
            };
            return Ok(zed::Command { command, args, env });
        }

        if let Some(path) = worktree
            .which("vibelang")
            .or_else(|| worktree.which("vibe"))
        {
            return Ok(zed::Command {
                command: path,
                args: configured_args.unwrap_or_else(Self::default_args),
                env,
            });
        }

        Err(
            "Could not find `vibelang` in workspace `node_modules/.bin` or on `PATH`.              Install `vibelang` in your project (`npm install -D vibelang` or `bun add -d vibelang`),              put `vibelang` on `PATH`, or set `lsp.vibelang.binary.path` in `.zed/settings.json`."
                .to_string(),
        )
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        let options = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.initialization_options);
        Ok(options)
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.settings);
        Ok(settings)
    }
}

zed::register_extension!(VibeExtension);
