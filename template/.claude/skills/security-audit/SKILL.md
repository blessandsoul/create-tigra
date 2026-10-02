---
name: security-audit
description: Security guidance and vulnerability review for codebases, APIs, services, CLI tools, libraries, and daemons. Use for security questions, focused reviews, vulnerability research, security audits, or pen tests. Run the complete workflow only for explicit codebase audit or pen-test requests, full/comprehensive/end-to-end reviews, or requested report artifacts.
---

# Security Audit (pointer)

This is a thin pointer so Claude Code discovers the skill. The real skill is shared with Codex and lives in `.agents/skills/security-audit/` (vendored from Cloudflare's `security-audit-skill`; see its `SOURCE.md`). Do not copy it here, so the two agents never drift.

Read `.agents/skills/security-audit/SKILL.md` in full and follow it exactly. Resolve every relative file it references (for example `HUNTING.md`, `report-schema.json`, the `validate-*.cjs` scripts) against `.agents/skills/security-audit/`, not this directory. Its "Task tool" is Claude Code's subagent mechanism.
