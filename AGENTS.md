<!-- gitnexus:start -->
# GitNexus — one-shot CLI

This repository is indexed by GitNexus as **create-tigra**. For structural code questions only, use the globally installed `gitnexus` CLI through short-lived terminal commands.

- Check freshness with `gitnexus status` from this repository root.
- Explore a flow with `gitnexus query -r create-tigra "<concept>" -l 5`.
- Inspect a symbol with `gitnexus context -r create-tigra <symbol>`.
- Check blast radius with `gitnexus impact -r create-tigra <symbol> --direction upstream --depth 3`.
- Use `gitnexus cypher -r create-tigra "<read-only query>"` only when the smaller commands cannot answer the question.
- Confirm graph conclusions by reading source and running relevant tests.

Do not use GitNexus for general questions, prose, product/UX design, or trivial literal lookups. Never start `gitnexus mcp`, `serve`, `eval-server`, or `setup`; never launch it in the background; never use `npx` for it. Do not run `analyze` automatically. If the index is missing or stale, use source search and mention it briefly. When Tornike explicitly requests indexing, run `gitnexus analyze --skip-agents-md` and do not enable embeddings unless requested.

Use at most three graph commands per task unless Tornike asks for a deeper graph investigation. If a command fails or hangs, stop and fall back to source inspection instead of retrying in a loop.
<!-- gitnexus:end -->
