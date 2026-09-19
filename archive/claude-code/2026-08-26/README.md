# Archived Claude Code configuration

Archived on 2026-08-26 after create-tigra moved to concise Codex-native `AGENTS.md` guidance.

The archive is intentionally outside active instruction-discovery paths and outside the npm package's published `files` list. It preserves the repository Claude configuration and the Claude configuration previously emitted by the scaffold. The scaffold copy includes all uncommitted edits that existed when it was archived.

## Layout

- `repository/CLAUDE.md` and `repository/.claude/`: former create-tigra repository configuration.
- `scaffold-template/_claude/`: former generated-project configuration.
- `repository/.developer-role`, `.claude/settings.local.json`, and `.codex/`: machine-local legacy role-restriction state; retained locally and intentionally ignored by Git. The old Codex hook called a Claude-oriented script and was not part of the replacement instruction system.

## Restore

1. Move `repository/CLAUDE.md` and `repository/.claude/` back to the repository root.
2. Move `scaffold-template/_claude/` back to `template/_claude/`.
3. In `bin/create-tigra.js`, restore the copy mapping `if (entry.name === '_claude') destName = '.claude';` after the `gitignore` mapping.
4. If the old path-restriction workflow is wanted, restore `.developer-role` generation and the corresponding ignore entries from Git history.

Restoring the archive does not require removing the Codex `AGENTS.md` files, but running both instruction systems at once can reintroduce conflicting guidance.
