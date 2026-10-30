//! Silent shell integration delivered through each shell's own startup path.
//!
//! The hook used to be written into the PTY as keystrokes, so the whole script
//! was echoed on screen before the first prompt. Delivering it as startup files
//! keeps the OSC 133/7 sequences while nothing is printed.

use std::io::Write;
use std::path::{Path, PathBuf};

/// Shells whose startup path can be redirected without editing the user's own
/// configuration. Everything else is launched untouched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShellFlavor {
    Bash,
    Zsh,
}

impl ShellFlavor {
    /// Identified from the executable `setup_pty` launches, which a profile may
    /// name either as `zsh` or as an absolute path.
    pub(crate) fn of(shell: &str) -> Option<Self> {
        match Path::new(shell).file_name().and_then(|name| name.to_str()) {
            Some("bash") => Some(Self::Bash),
            Some("zsh") => Some(Self::Zsh),
            _ => None,
        }
    }
}

/// bash names its wrapper file explicitly; zsh asks for the files it wants.
const BASH_RCFILE: &str = ".terminal-bashrc";

/// The `ZDOTDIR` handed to the wrapper, kept so zsh can restore it.
const REAL_ZDOTDIR_VAR: &str = "TERMINAL_REAL_ZDOTDIR";

/// OSC 133 D with the previous exit code, OSC 133 A for the new prompt and
/// OSC 7 with the working directory. The frontend rejects a cwd that is not a
/// `file:` URL, so the path is written as a URI rather than raw.
const PROMPT_HOOK_BODY: &str = r#"printf '\033]133;D;%s\007' "$?"; printf '\033]133;A\007'; printf '\033]7;file://%s\007' "$PWD""#;

fn prompt_hook() -> String {
    format!("__TI_A(){{ {PROMPT_HOOK_BODY}; }}")
}

/// The zsh wrapper replaces the user's files, so it has to forward to them
/// first; otherwise every rc file the user maintains would silently stop
/// loading. `ZDOTDIR` is the directory zsh would read them from, and `$HOME` is
/// what zsh itself falls back to when it is unset.
const ZSH_RC_DIR: &str = "\"${TERMINAL_REAL_ZDOTDIR:-$HOME}\"";

fn source_zsh_user_rc(name: &str) -> String {
    format!("if [ -r {ZSH_RC_DIR}/{name} ]; then source {ZSH_RC_DIR}/{name}; fi\n")
}

/// bash always reads its rc files from `$HOME`.
fn source_bash_user_rc(name: &str) -> String {
    format!("if [ -r \"$HOME/{name}\" ]; then source \"$HOME/{name}\"; fi\n")
}

/// zsh reads every startup file from `$ZDOTDIR`, so each wrapper only forwards
/// to the user's file of the same name; the hooks go last in `.zshrc` so the
/// user's rc cannot replace them afterwards.
pub(crate) fn zsh_wrapper_files() -> [(&'static str, String); 4] {
    [
        (".zshenv", source_zsh_user_rc(".zshenv")),
        (".zprofile", source_zsh_user_rc(".zprofile")),
        (
            ".zshrc",
            format!(
                "{}{}{}",
                restore_zdotdir(),
                source_zsh_user_rc(".zshrc"),
                zsh_hook_install()
            ),
        ),
        (".zlogin", source_zsh_user_rc(".zlogin")),
    ]
}

/// compinit and other zsh tooling resolve their cache files through `ZDOTDIR`
/// (compinit writes `$ZDOTDIR/.zcompdump`), so a wrapper left in place would
/// push them into a directory that is deleted when the session ends. The value
/// is restored before the user's rc runs, and the remaining startup files are
/// then read from where the user actually keeps them.
fn restore_zdotdir() -> String {
    let var = REAL_ZDOTDIR_VAR;
    format!("if [ -n \"${var}\" ]; then export ZDOTDIR=\"${var}\"; else unset ZDOTDIR; fi\n")
}

fn zsh_hook_install() -> String {
    // `add-zsh-hook` appends, so a precmd/preexec pair the user's rc installed
    // keeps running next to ours instead of being replaced by it. Passing the
    // hook a quoted string instead of a function name fails with "function
    // definition file not found", so both hooks are named functions.
    format!(
        "{}\n__TI_B(){{ printf '\\033]133;B\\007'; }}\nautoload -Uz add-zsh-hook\nadd-zsh-hook precmd __TI_A\nadd-zsh-hook preexec __TI_B\n",
        prompt_hook()
    )
}

/// The login profile bash would read is the *first* one of these that exists;
/// sourcing all three would run rc files bash itself never runs.
const BASH_LOGIN_FILES: [&str; 3] = [".bash_profile", ".bash_login", ".profile"];

/// `/etc/profile` is where a login shell gets its PATH (macOS runs path_helper
/// from there) and a login bash ignores `--rcfile`, so the hook needs `-l` gone
/// and the login sequence replayed here to keep the login environment.
fn bash_login_sequence() -> String {
    let mut sequence = String::from("if [ -r /etc/profile ]; then source /etc/profile; fi\n");
    for (index, name) in BASH_LOGIN_FILES.iter().enumerate() {
        let branch = if index == 0 { "if" } else { "elif" };
        sequence.push_str(&format!(
            "{branch} [ -r \"$HOME/{name}\" ]; then source \"$HOME/{name}\"; "
        ));
    }
    sequence.push_str("fi\n");
    sequence
}

/// bash reads `--rcfile` in place of `~/.bashrc` for an interactive shell, so
/// the wrapper replays the login files, forwards to the user's rc and installs
/// the hook last.
pub(crate) fn bash_rcfile_contents() -> String {
    // A `trap ... DEBUG` would be the only way to emit `133;B`, and it is
    // deliberately not used: bash has no additive trap, so setting one silently
    // replaces whatever the user's own rc already installed. A real bashrc with
    // a DEBUG trap was verified to lose it -- and with it every `133;B` -- while
    // `133;A`, `133;D` and the cwd kept working without the trap. Since
    // command-start only feeds an internal phase field with no consumer,
    // trading a user's own tooling for it is the wrong deal.
    //
    // PROMPT_COMMAND is prepended to rather than replaced so an existing hook
    // keeps running, and PS1 is left untouched so the prompt survives.
    format!(
        "{}{}\n{}\nPROMPT_COMMAND=\"__TI_A${{PROMPT_COMMAND:+;$PROMPT_COMMAND}}\"\n",
        bash_login_sequence(),
        source_bash_user_rc(".bashrc"),
        prompt_hook()
    )
}

/// Startup files for one session. Removing the directory is the session's
/// cleanup, so the value must live exactly as long as its shell does.
pub(crate) struct ShellStartup {
    directory: PathBuf,
    args: Vec<String>,
    env: Vec<(&'static str, PathBuf)>,
}

impl ShellStartup {
    /// Build the wrapper for `flavor` in the system temporary directory.
    ///
    /// `previous_zdotdir` is the `ZDOTDIR` this wrapper replaces, when the user
    /// already had one, so zsh can hand it back while its rc runs.
    pub(crate) fn prepare(
        flavor: ShellFlavor,
        previous_zdotdir: Option<&str>,
    ) -> std::io::Result<Self> {
        let directory =
            std::env::temp_dir().join(format!("terminal-shell-{}", uuid::Uuid::new_v4()));
        private_dir_builder().create(&directory)?;
        let mut startup = Self {
            directory,
            args: Vec::new(),
            env: Vec::new(),
        };
        // The directory already belongs to `startup`, so a failure below still
        // removes it through `Drop`.
        match flavor {
            ShellFlavor::Zsh => {
                for (name, contents) in zsh_wrapper_files() {
                    startup.write_file(name, &contents)?;
                }
                // zsh resolves every startup file relative to ZDOTDIR.
                startup.env.push(("ZDOTDIR", startup.directory.clone()));
                if let Some(previous) = previous_zdotdir {
                    startup
                        .env
                        .push((REAL_ZDOTDIR_VAR, PathBuf::from(previous)));
                }
            }
            ShellFlavor::Bash => {
                startup.write_file(BASH_RCFILE, &bash_rcfile_contents())?;
                startup.args.push("--rcfile".to_string());
                startup.args.push(
                    startup
                        .directory
                        .join(BASH_RCFILE)
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        Ok(startup)
    }

    pub(crate) fn directory(&self) -> &Path {
        &self.directory
    }

    pub(crate) fn args(&self) -> &[String] {
        &self.args
    }

    pub(crate) fn env(&self) -> &[(&'static str, PathBuf)] {
        &self.env
    }

    fn write_file(&self, name: &str, contents: &str) -> std::io::Result<()> {
        // The wrapper decides which files a new shell sources, so no other
        // account may read or replace it.
        private_file_options()
            .open(self.directory.join(name))?
            .write_all(contents.as_bytes())
    }
}

impl Drop for ShellStartup {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.directory) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    directory = %self.directory.display(),
                    %error,
                    "failed to remove the shell startup directory"
                );
            }
        }
    }
}

#[cfg(unix)]
fn private_dir_builder() -> std::fs::DirBuilder {
    use std::os::unix::fs::DirBuilderExt;
    let mut builder = std::fs::DirBuilder::new();
    builder.mode(0o700);
    builder
}

#[cfg(not(unix))]
fn private_dir_builder() -> std::fs::DirBuilder {
    std::fs::DirBuilder::new()
}

#[cfg(unix)]
fn private_file_options() -> std::fs::OpenOptions {
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true).mode(0o700);
    options
}

#[cfg(not(unix))]
fn private_file_options() -> std::fs::OpenOptions {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zsh_wrapper_forwards_every_user_file_and_installs_both_hooks() {
        let files = zsh_wrapper_files();
        assert_eq!(
            files.iter().map(|(name, _)| *name).collect::<Vec<_>>(),
            vec![".zshenv", ".zprofile", ".zshrc", ".zlogin"],
            "zsh loads exactly these four files from ZDOTDIR"
        );
        for (name, contents) in &files {
            assert!(
                contents.contains(&format!("source {ZSH_RC_DIR}/{name}")),
                "{name} must forward to the user's own file: {contents}"
            );
            // Without the original value the wrapper cannot tell zsh where the
            // user's files are once it hands ZDOTDIR back.
            assert!(contents.contains(REAL_ZDOTDIR_VAR));
        }

        let zshrc = &files[2].1;
        let restore = zshrc
            .find("export ZDOTDIR=")
            .expect("the wrapper has to hand the real ZDOTDIR back");
        let user_rc = zshrc
            .find(&format!("source {ZSH_RC_DIR}/.zshrc"))
            .expect("the user's rc has to be sourced");
        let hook = zshrc
            .find("add-zsh-hook precmd __TI_A")
            .expect("the precmd hook has to be installed");
        assert!(
            restore < user_rc,
            "ZDOTDIR has to be restored before the user's rc caches through it: {zshrc}"
        );
        assert!(
            user_rc < hook,
            "the hook must come after the user's rc: {zshrc}"
        );
        assert!(zshrc.contains("add-zsh-hook preexec __TI_B"));
        assert!(zshrc.contains("133;D;%s"));
        assert!(zshrc.contains("133;A"));
        assert!(zshrc.contains("133;B"));
        assert!(zshrc.contains("7;file://%s"));
        // Reassigning PS1 would replace the user's prompt instead of hooking
        // alongside it.
        assert!(!zshrc.contains("PS1="));
    }

    #[test]
    fn bash_rcfile_sources_the_user_rc_then_prepends_prompt_command() {
        let contents = bash_rcfile_contents();
        let user_rc = contents
            .find("source \"$HOME/.bashrc\"")
            .expect("the user's rc has to be sourced");
        let hook = contents
            .find("PROMPT_COMMAND=\"__TI_A")
            .expect("PROMPT_COMMAND has to be prepended");
        assert!(
            user_rc < hook,
            "the hook must come after the user's rc: {contents}"
        );
        assert!(contents.contains("133;D;%s"));
        assert!(contents.contains("133;A"));
        assert!(contents.contains("7;file://%s"));
        // bash has no additive DEBUG trap, so installing one would replace
        // whatever the user's rc already set; see the comment on the builder.
        assert!(!contents.contains("trap "));
        assert!(!contents.contains("PS1="));
    }

    #[test]
    fn bash_rcfile_replays_the_login_sequence_before_the_user_rc() {
        let contents = bash_rcfile_contents();
        assert!(
            contents.contains("if [ -r /etc/profile ]; then source /etc/profile; fi"),
            "the login PATH setup has to run: {contents}"
        );
        let etc = contents.find("source /etc/profile").expect("/etc/profile");
        // bash reads only the *first* of the three login profiles, so they have
        // to share one if/elif chain; three separate sources would run rc files
        // bash itself never runs.
        let chain = contents
            .lines()
            .find(|line| line.contains("/.bash_profile"))
            .expect("the login profile chain");
        assert!(
            chain.starts_with("if [ -r \"$HOME/.bash_profile\" ]"),
            "the first existing profile has to win: {chain}"
        );
        assert_eq!(
            chain.matches("elif").count(),
            2,
            "the three login files must share a single chain: {chain}"
        );
        for name in BASH_LOGIN_FILES {
            assert_eq!(
                chain.matches(name).count(),
                2,
                "{name} is guarded and sourced inside the one chain: {chain}"
            );
            assert_eq!(
                contents.matches(name).count(),
                2,
                "{name} must never be sourced from a second place: {contents}"
            );
        }

        let user_rc = contents
            .find("source \"$HOME/.bashrc\"")
            .expect("the user's rc still has to be sourced");
        let chain_at = contents.find(chain).expect("chain offset");
        let hook = contents
            .find("PROMPT_COMMAND=\"__TI_A")
            .expect("PROMPT_COMMAND has to be prepended");
        assert!(
            etc < chain_at && chain_at < user_rc && user_rc < hook,
            "login files, then the user's rc, then the hook: {contents}"
        );
    }

    #[test]
    fn only_shells_with_a_redirectable_startup_path_are_injected() {
        assert_eq!(ShellFlavor::of("/bin/zsh"), Some(ShellFlavor::Zsh));
        assert_eq!(
            ShellFlavor::of("/usr/local/bin/zsh"),
            Some(ShellFlavor::Zsh)
        );
        assert_eq!(ShellFlavor::of("bash"), Some(ShellFlavor::Bash));
        assert_eq!(ShellFlavor::of("/bin/fish"), None);
        assert_eq!(ShellFlavor::of("/bin/sh"), None);
        assert_eq!(ShellFlavor::of("pwsh.exe"), None);
        assert_eq!(ShellFlavor::of(r"C:\Windows\System32\cmd.exe"), None);
    }

    #[test]
    fn zsh_wrapper_directory_is_owner_only_and_removed_on_drop() {
        let startup = ShellStartup::prepare(ShellFlavor::Zsh, None).expect("wrapper directory");
        let directory = startup.directory().to_path_buf();
        assert!(directory.is_dir());
        assert!(startup.args().is_empty(), "zsh needs no extra argument");
        assert_eq!(startup.env().len(), 1);
        assert_eq!(startup.env()[0].0, "ZDOTDIR");
        assert_eq!(startup.env()[0].1, directory);
        for name in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            assert!(directory.join(name).is_file(), "{name} must be written");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let directory_mode = std::fs::metadata(&directory)
                .expect("directory metadata")
                .permissions()
                .mode();
            assert_eq!(directory_mode & 0o777, 0o700);
            let file_mode = std::fs::metadata(directory.join(".zshrc"))
                .expect("wrapper metadata")
                .permissions()
                .mode();
            assert_eq!(file_mode & 0o777, 0o700);
        }

        drop(startup);
        assert!(
            !directory.exists(),
            "the wrapper must not outlive the session that owns it"
        );
    }

    #[test]
    fn zsh_wrapper_reports_the_zdotdir_it_replaced() {
        let startup = ShellStartup::prepare(ShellFlavor::Zsh, Some("/custom/zsh"))
            .expect("wrapper directory");
        let replaced = startup
            .env()
            .iter()
            .find(|(name, _)| *name == REAL_ZDOTDIR_VAR)
            .map(|(_, value)| value.as_path())
            .expect("the replaced ZDOTDIR has to reach the wrapper");
        assert_eq!(replaced, Path::new("/custom/zsh"));

        let bash =
            ShellStartup::prepare(ShellFlavor::Bash, Some("/custom/zsh")).expect("wrapper file");
        assert!(bash.env().is_empty(), "bash never touches ZDOTDIR");
    }

    #[test]
    fn bash_wrapper_is_passed_as_an_explicit_rcfile_and_removed_on_drop() {
        let startup = ShellStartup::prepare(ShellFlavor::Bash, None).expect("wrapper file");
        let directory = startup.directory().to_path_buf();
        let rcfile = directory.join(BASH_RCFILE);
        assert!(rcfile.is_file());
        assert!(startup.env().is_empty(), "bash needs no extra environment");
        assert_eq!(startup.args().len(), 2);
        assert_eq!(startup.args()[0], "--rcfile");
        assert_eq!(startup.args()[1], rcfile.to_string_lossy().as_ref());

        drop(startup);
        assert!(
            !directory.exists(),
            "the wrapper must not outlive the session that owns it"
        );
    }
}
