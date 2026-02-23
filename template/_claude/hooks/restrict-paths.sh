#!/bin/bash
# Restrict Claude's WRITE access based on the .developer-role file.
# Claude can always READ any file for full project context.
# Only Edit/Write operations are blocked on the other side's directory.
#
# NOTE: settings.json matcher already filters for Edit|Write only,
# so this script does NOT need to check the tool name.
#
# To switch roles, either:
#   1. Edit .developer-role and type: frontend, backend, or fullstack
#   2. Use /role command in Claude
#
# fullstack (or empty/missing file) = no restrictions

ROLE_FILE="$CLAUDE_PROJECT_DIR/.developer-role"

# Read role from file, trim whitespace
if [ -f "$ROLE_FILE" ]; then
  ROLE=$(tr -d '[:space:]' < "$ROLE_FILE")
else
  ROLE=""
fi

# No file, empty, or fullstack = full access
if [ -z "$ROLE" ] || [ "$ROLE" = "fullstack" ]; then
  exit 0
fi

# Read the full JSON input from Claude Code
INPUT=$(cat)

deny_with_reason() {
  cat <<DENY_EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"$1"}}
DENY_EOF
  exit 0
}

# Simple path check against the raw JSON input.
# No JSON parsing needed — just check if the input contains server/ or client/ paths.
if [ "$ROLE" = "frontend" ]; then
  if echo "$INPUT" | grep -qiE "server[/\\\\]"; then
    deny_with_reason "BLOCKED: Role is set to frontend. You can read server/ files but cannot modify them. Only the backend developer can edit server/ code."
  fi
elif [ "$ROLE" = "backend" ]; then
  if echo "$INPUT" | grep -qiE "client[/\\\\]"; then
    deny_with_reason "BLOCKED: Role is set to backend. You can read client/ files but cannot modify them. Only the frontend developer can edit client/ code."
  fi
fi

exit 0
