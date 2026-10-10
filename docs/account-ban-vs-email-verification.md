# Account ban vs email verification

## Status

Fixed in the create-tigra scaffold. Projects generated earlier that installed the email-verification module must be patched manually (see the last section).

## Issue

`User.isActive` used to mean two different things:

- "deactivated by an administrator" (a ban), set by `PATCH /api/v1/admin/users/:userId/status`;
- "has not verified their email yet", set at registration when `REQUIRE_USER_VERIFICATION` is on.

The email-verification module treated every `isActive = false` account as unverified. A banned user could call the public `POST /auth/send-verification` with their own email, open the link and call `POST /auth/verify-account`, which set `isActive = true` and logged them in. The ban was undone without an administrator. A banned administrator got admin rights back the same way.

## Fix

The two states are now separate:

| Field | Meaning | Who changes it |
|---|---|---|
| `isActive` | Admin ban switch only (false = deactivated) | Admins (`toggleUserStatus`), soft delete |
| `emailVerifiedAt` | When the email was verified; `null` = unverified | Registration (when verification is off), the verify link, an admin activating an unverified user |

- One helper, `src/libs/account-status.ts` (`assertAccountCanSignIn`), decides whether an account may hold a session. Login, refresh, `authenticate` and verify-account all use it. A banned account gets `403 ACCOUNT_DEACTIVATED`; an unverified account (while `REQUIRE_USER_VERIFICATION` is on) gets `403 EMAIL_NOT_VERIFIED`.
- Login checks account state only after the password is correct, so an anonymous caller cannot learn whether an email is banned or unverified.
- The verification module never touches `isActive`. `sendVerification` issues no token for a banned or already-verified account, and `verifyAccount` refuses a banned account even with a token issued before the ban. It marks the email with a conditional update (`markEmailVerified`), so a ban that lands mid-verification still wins.
- The client sends only `EMAIL_NOT_VERIFIED` to `/verify-account`; a banned user is told the account is deactivated.

## Patch an existing generated project

1. Add `emailVerifiedAt DateTime?` to `User` in `prisma/schema.prisma` and create a migration.
2. **Backfill, decided per project.** Existing rows with `isActive = true` can safely get `emailVerifiedAt = createdAt`. Rows with `isActive = false` are ambiguous (banned or never verified); list them and decide: leave banned users as they are, and for unverified users set `isActive = true` with `emailVerifiedAt = null` so they can still verify.
3. Port the server changes: `src/libs/account-status.ts`, `authenticate` in `src/libs/auth.ts`, register/login/refresh in `src/modules/auth/auth.service.ts`, `toggleUserStatus` in the admin service, and the module's `verification.service.ts` plus `markEmailVerified` in `auth.repo.ts`.
4. Port the client error codes (`ACCOUNT_DEACTIVATED`, `EMAIL_NOT_VERIFIED`) and the register redirect on `!user.emailVerifiedAt`.
5. Test: ban a user, request a verification email for them, and verify with a token issued before the ban. Both must leave the account banned with no session.
