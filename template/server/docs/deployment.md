# Deploying

The server and the client deploy as two Coolify applications from their own Dockerfiles. The setup checklist is in
the main README ("Deploying to Coolify"); this page explains what a deploy does and the rules that follow from it.

## What a deploy does

1. Coolify builds the image. The server's build compiles libvips (see "Build time" below), installs the exact
   lockfile, builds the code and proves that sharp works in the final image.
2. Coolify starts a **new** container next to the one that is serving. Its start command:
   - refuses to start when the image has no Prisma migrations;
   - runs `prisma migrate deploy`, which applies the migrations the database does not have yet. A database it cannot
     reach stops the start here;
   - starts the server. In production the server also refuses to start when it cannot reach Redis within 10 s.
3. Coolify waits for the image's Docker `HEALTHCHECK` (server: `/api/v1/live`, client: `/healthz`), then sends traffic
   to the new container and stops the old one. The server finishes its in-flight requests and closes within 8 s
   (Docker's limit is 10 s).

If the new container never becomes healthy (a failed migration, no Redis, a crash), Coolify keeps the old container
serving, and the deploy shows as failed.

## Migrations: expand, deploy, contract

Between steps 2 and 3 the **old** code runs against the **new** schema, and nothing can roll a migration back: a
redeploy of an older commit only runs `migrate deploy` again, which moves forward. So every migration must work with
the code that is still running:

1. **Expand.** Add tables, columns (nullable or with a default) and indexes. Deploy.
2. **Move the code** to the new shape, and backfill data if needed. Deploy.
3. **Contract**, in a later deploy: drop or rename only what no running code uses any more.

Never in the same deploy as the code that stops using it:

- drop a column or a table;
- rename one: Prisma writes a rename as drop + add, losing the data unless you edit the migration. To rename only in
  the code, keep the database name with `@map` / `@@map`;
- change a column's type, or make it required without a default.

The old container would read or write the old shape for the length of the switch and fail.

Before a risky migration, back up the database (on Coolify: the database's Backups tab, run a backup now). To undo
one, write a new forward migration, or restore the backup, losing what was written since.

## Rolling back the code

Redeploy the previous commit, or use Coolify's rollback on the Deployments tab. That is safe as long as the schema
still suits the old code, which is what expand / deploy / contract guarantees.

## Build time: libvips

Both images compile libvips, the image library behind sharp, from source. sharp's prebuilt binaries need x86-64-v2
CPU features that some VPS CPUs lack; the images build libvips for baseline x86-64, so they run on any x86-64 server.

Uncached, the compile takes about 6 to 7 minutes of the server's CPU per application (measured on a shared VPS:
6.2 to 6.6 minutes, about 8.5 minutes for the whole server deploy), and other apps on the same server can slow down
meanwhile. Docker keeps the compiled stage in that server's build cache, and a later deploy that reuses it finishes
in 1 to 2 minutes. Expect the long build on the first deploy of each application to a server (the two do not share
it on Coolify), after a change to a build-time variable (the client's `NEXT_PUBLIC_*` values), after the server's
build cache was cleaned up, and when the base image or `LIBVIPS_VERSION` changes. Other deploys may hit the cache,
but do not count on it.

The fix for later: build the libvips stage once into a base image in a registry (it needs CI to publish it) and
start both Dockerfiles from it. Until then, deploy when the server is quiet if its other apps are sensitive to load.
