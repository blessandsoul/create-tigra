# Account Deactivation Login Reactivation

## Status

Fixed in the create-tigra scaffold. Projects generated before this fix must be patched manually.

## Issue

Self-service account deletion soft-deactivates the user by setting `deletedAt` and `isActive = false`, then invalidates the user's sessions and refresh tokens. The previous login flow undid that state: when it could not find a non-deleted user, it looked up the soft-deleted record, verified its password, cleared `deletedAt`, set `isActive = true`, and issued new authentication tokens.

The result was contradictory behavior: the application confirmed that the account was deactivated and logged the user out, but the same credentials immediately reactivated it. This was not an authentication bypass because the correct password was still required; it was an unintended reactivation path that broke the deactivation contract.

## Fix

Login now considers only non-deleted users. A soft-deleted account receives the same `INVALID_CREDENTIALS` response as an unknown email, and login does not verify its password, create a session, or issue tokens. The obsolete repository `restoreUser` operation was removed.

This does not change the other account states:

- A non-deleted, active account can still log in normally.
- A non-deleted account with `isActive = false`, including an account deactivated by an administrator, is still rejected with `ACCOUNT_NOT_ACTIVE`.
- Registration still reserves the email while a soft-deleted record exists, but no longer tells the user that logging in will restore it.
- Self-deletion still invalidates all sessions and refresh tokens.
- The existing cleanup job still permanently purges soft-deleted accounts after the 30-day retention period. No database migration is required.

## Patch an Existing Generated Project

Apply these changes in the generated project's `server` directory:

1. In `src/modules/auth/auth.service.ts`, make `login` stop immediately when `findUserByEmail` returns `null`:

   ```ts
   const user = await authRepo.findUserByEmail(input.email);
   if (!user) {
     throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
   }
   ```

   Remove the entire fallback that calls `findDeletedUserByEmail`, verifies the deleted user's password, calls `restoreUser`, and mutates the user back to an active state. Leave the normal inactive-account, lockout, password, session, and token logic unchanged.

2. In `src/modules/auth/auth.repo.ts`, delete the exported `restoreUser` function. Keep `findDeletedUserByEmail`; registration uses it to reserve an email during the retention period.

3. In the registration conflict branch in `src/modules/auth/auth.service.ts`, replace the login-to-restore message with wording that does not promise restoration, for example:

   ```ts
   'An account with this email was recently deleted and cannot be registered yet.'
   ```

4. Add a regression test proving that when `findUserByEmail` returns `null`, even a correct password cannot lead to password verification, account restoration, session creation, or token issuance. Retain coverage for normal active login and rejection of non-deleted inactive accounts.

5. Run the server's focused auth test, typecheck, and lint commands.

No schema or data migration is needed. Accounts that were already silently reactivated before this patch have `deletedAt = null` and `isActive = true`, so the code cannot distinguish them from ordinary active accounts. Those users must deactivate again after the patch, or the application owner must explicitly deactivate them after confirming their intent.
