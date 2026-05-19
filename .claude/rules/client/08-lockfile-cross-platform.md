> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Lockfile — Cross-Platform Regeneration

`client/package-lock.json` has burned us — and bots — multiple times in projects scaffolded from this template. Read this before touching it.

## The trap

`client/package-lock.json` is consumed by **three different environments**:

| Environment | OS / libc | npm |
|---|---|---|
| Local dev (most contributors) | Windows / macOS | npm 11.x |
| GitHub Actions CI (`server-ci.yml`, `client-ci.yml`) | `ubuntu-latest` (Debian glibc) | npm 10.x (ships with Node 20) |
| Coolify / production deploy (`client/Dockerfile`) | `node:20-alpine` (musl) | npm 10.x |

`npm ci` is **strict** — it refuses to install if the lockfile is even slightly out of sync with `package.json`, AND it only installs the platform-specific `optionalDependencies` whose top-level `node_modules/<pkg>` entries exist in the lockfile. If you regenerate on Windows with `npm install`, you get a Windows-leaning lockfile that:

1. May be missing entries the newer npm 10 (CI) considers required (`Missing: @swc/helpers@0.5.21 from lock file` — common failure mode).
2. Lacks `*-linux-x64-gnu` / `*-linuxmusl-x64` entries → CI's `next build` fails with `Cannot find module '../lightningcss.linux-x64-gnu.node'` or `No prebuild or local build of @parcel/watcher found.`

Affected native packages (Next 16 + Tailwind v4 dep tree): `@parcel/watcher`, `lightningcss`, `@img/sharp`, `@next/swc`, `@swc/core`, `@tailwindcss/oxide`, `@unrs/resolver-binding`, `@rolldown/binding`.

## Canonical fix (use this exactly)

Whenever you regenerate `client/package-lock.json` — even just because `package.json` changed by one dep — run **all three** steps. They are additive (`--package-lock-only` doesn't touch `node_modules`).

```bash
cd client

# 0. (Optional) Start fresh if the existing lockfile is already broken:
rm -rf node_modules package-lock.json

# 1. Sync the lockfile against package.json (fixes the "Missing: foo from lock file" class).
npx -y npm@10 install --package-lock-only

# 2. Add Linux/glibc native variants (GitHub Actions Ubuntu).
npx -y npm@10 install --os=linux --cpu=x64 --libc=glibc --package-lock-only

# 3. Add Linux/musl native variants (Coolify Alpine deploy).
npx -y npm@10 install --os=linux --cpu=x64 --libc=musl --package-lock-only
```

### Required choices

- **`npx -y npm@10` explicitly.** Local default npm 11.x resolves a tree npm 10 strict-checks reject. Match CI's npm version or you'll push a lockfile that fails immediately.
- **`--package-lock-only`** keeps each command at ~1 sec (no install, no audit).
- **Three platforms.** Even if you only intend to fix CI, do the musl pass too — Coolify deploy will fail otherwise.
- **Skip darwin** unless a team member dev's on macOS and reports `npm ci` failing. Not worth the lockfile churn pre-emptively.

## Verify before committing

```bash
cd client

# A. Strict install passes with CI's npm version (this is the exact check CI runs):
npx -y npm@10 ci --include=optional --no-audit --no-fund 2>&1 | tail -3
# Expect: "added N packages in Xs". Any "EUSAGE" / "Missing:" means step 1 didn't take.

# B. All native deps have glibc + musl entries:
for pkg in '@next/swc' '@swc/core' '@parcel/watcher' '@rolldown/binding' \
           '@tailwindcss/oxide' '@unrs/resolver-binding' 'lightningcss'; do
  g=$(grep -cE "node_modules/${pkg}.*-linux-x64-(gnu|glibc)\"" package-lock.json)
  m=$(grep -cE "node_modules/${pkg}-linux-x64-musl\"" package-lock.json)
  echo "$pkg glibc=$g musl=$m"
done
# Expect every line: glibc=1 musl=1. (sharp uses different naming — check separately:
# grep -oE 'node_modules/@img/sharp[-a-z0-9]*' package-lock.json | sort -u)
```

If either check fails, the lockfile is not ready — do not commit.

## Anti-patterns (don't do these — every one has burned us)

1. **Plain `npm install` on Windows/macOS.** Uses local npm 11; produces lockfiles CI rejects.
2. **Whack-a-mole pinning** in `package.json` `optionalDependencies` (e.g., adding only `@parcel/watcher-linux-x64-glibc` and hoping it fixes everything). It doesn't — there are 7+ such native deps and you'll bounce through them one CI failure at a time.
3. **Disabling `npm ci` in CI** by switching to `npm install` to "fix" the symptom. That makes builds non-reproducible.
4. **Bypassing the husky pre-commit hook** with `--no-verify` to push a broken lockfile fast.
5. **Generating inside Docker on a hung Docker daemon** without verifying the daemon is healthy first — the run silently buffers and you wait 10+ minutes. (The non-Docker `npx npm@10 install --package-lock-only` chain above is faster and equally correct.)
