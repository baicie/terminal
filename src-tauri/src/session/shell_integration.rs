//! Explicit shell-integration snippets for interactive terminal sessions.
//!
//! Integration is opt-in per terminal profile.  The snippets deliberately
//! hook the selected shell without replacing user prompt hooks or traps.

use super::types::ShellIntegrationMode;

/// Return the one-line startup snippet for an explicitly selected shell.
pub(crate) fn integration_script(mode: ShellIntegrationMode) -> &'static str {
    match mode {
        ShellIntegrationMode::Bash => BASH_SCRIPT,
        ShellIntegrationMode::Zsh => ZSH_SCRIPT,
    }
}
/// Compose integration with a user-provided startup command.
///
/// The integration script is sent first so the user's command runs after the
/// hooks are installed.  `None` means no startup bytes should be sent at all.
pub(crate) fn compose_startup_command(
    mode: Option<ShellIntegrationMode>,
    user_command: Option<&str>,
) -> Option<String> {
    match (
        mode,
        user_command
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    ) {
        (None, None) => None,
        (None, Some(command)) => Some(command.to_string()),
        (Some(mode), user_command) => {
            let script = integration_script(mode);
            Some(match user_command {
                Some(command) => format!("{script}\n{command}"),
                None => script.to_string(),
            })
        }
    }
}

// Keep each script on one line: it is written into an already running PTY and
// an accidental continuation line would alter the user's initial prompt.
const BASH_SCRIPT: &str = r#"test -n "$BASH_VERSION" && eval '__TI_A(){ printf '\''\033]133;D;%s\007'\'' "$?"; printf '\''\033]133;A\007'\''; printf '\''\033]7;file://%s\007'\'' "$PWD"; }; PROMPT_COMMAND="__TI_A${PROMPT_COMMAND:+;$PROMPT_COMMAND}"'"#;

const ZSH_SCRIPT: &str = r#"test -n "$ZSH_VERSION" && { __TI_A(){ printf '\033]133;D;%s\007' "$?"; printf '\033]133;A\007'; printf '\033]7;file://%s\007' "$PWD"; }; __TI_B(){ printf '\033]133;B\007'; }; autoload -Uz add-zsh-hook; add-zsh-hook precmd __TI_A; add-zsh-hook preexec __TI_B; }"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_are_single_line_and_keep_existing_hooks() {
        for mode in [ShellIntegrationMode::Bash, ShellIntegrationMode::Zsh] {
            let script = integration_script(mode);
            assert!(!script.contains('\n'));
            assert!(script.contains("133;D;%s"));
            assert!(script.contains("133;A"));
            assert!(script.contains("7;file://%s"));
            assert!(script.contains("BASH_VERSION") || script.contains("ZSH_VERSION"));
            assert!(!script.contains("PS1="));
            assert!(!script.contains("trap "));
            if mode == ShellIntegrationMode::Zsh {
                assert!(script.contains("133;B"));
            }
        }
    }

    #[test]
    fn composition_is_opt_in_and_preserves_user_command() {
        assert_eq!(compose_startup_command(None, None), None);
        assert_eq!(
            compose_startup_command(None, Some("  cd ~/project  ")),
            Some("cd ~/project".to_string())
        );
        let combined =
            compose_startup_command(Some(ShellIntegrationMode::Bash), Some("echo ready"))
                .expect("explicit integration should produce startup bytes");
        assert!(combined.starts_with("test -n \"$BASH_VERSION\" && eval"));
        assert!(combined.ends_with("\necho ready"));
    }

    #[test]
    fn zsh_script_uses_native_quoting_without_bash_eval_bridge() {
        let script = integration_script(ShellIntegrationMode::Zsh);
        assert!(script.starts_with("test -n \"$ZSH_VERSION\" && { __TI_A(){"));
        assert!(!script.contains("eval '"));
        assert!(script.ends_with("preexec __TI_B; }"));
    }
}
