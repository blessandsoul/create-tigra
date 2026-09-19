---
name: role
description: Switch developer role to restrict Claude's access to frontend-only, backend-only, or full access
argument-hint: "[frontend | backend | fullstack]"
disable-model-invocation: true
allowed-tools: Read, Write
---

The user wants to switch their developer role. The argument is: $ARGUMENTS

Read the file `.developer-role` in the project root to see the current role.

## Rules

- If the argument is `frontend`, `backend`, or `fullstack` — write that word to `.developer-role` and confirm the switch.
- If no argument is given — read `.developer-role` and tell the user their current role, then ask which role they want.
- If the argument is not one of the three valid roles — tell the user the valid options.

## What each role does

Claude can always READ all files for full project context. Only WRITE access is restricted.

| Role | Can edit |
|------|---------|
| `frontend` | `client/` only. Cannot edit `server/` files. |
| `backend` | `server/` only. Cannot edit `client/` files. |
| `fullstack` | Everything. No restrictions. |

## Response format

After switching, confirm like this:

```
Role switched to **{role}**.

- frontend → can edit client/ only (can read everything)
- backend → can edit server/ only (can read everything)
- fullstack → can edit everything
```
