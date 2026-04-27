> **SCOPE**: These rules apply to the **entire workspace** (server + client). Always active.

# Investigation Before Conclusions

This project (create-tigra) generates starter templates for developers who may not have deep coding experience. They trust AI output without questioning it. **A wrong suggestion that "fixes" a non-existent problem can introduce real problems.** Every recommendation must be grounded in verified understanding of how the code actually works.

---

## The Rule

**Never suggest fixes, changes, or improvements until you have fully traced how the relevant system works in this codebase.** Seeing a file, a config, or a pattern is not enough. You must follow the code path end-to-end before making any claim.

---

## Before Answering "Is This a Bug?" or "Does This Need Fixing?"

1. **Trace the actual workflow.** If the question is about uploads, go read the upload service, follow where files are saved, how they're served, how they're deleted. If it's about auth, trace the full auth flow. Don't stop at the first file you find.

2. **Understand the runtime environment.** Ask yourself: does this code run in Docker or locally? Is this a dev tool or a production path? Does docker-compose run the server or just infrastructure services (MySQL, Redis)? Don't assume — verify.

3. **Verify the problem exists in the real workflow.** Not in theory, not in a hypothetical scenario — in the actual way developers use this project. If no one would ever hit the issue in normal usage, it's not a problem worth fixing.

4. **Don't pattern-match to conclusions.** "Uploads + Docker + no volume = must fix" is pattern-matching, not investigation. The server runs locally with `npm run dev`, not inside Docker. The `docker-compose.yml` is for MySQL and Redis only. A volume for uploads in docker-compose would solve nothing.

5. **If you're unsure, say so.** "I need to check how this works before I can answer" is always better than a confident wrong answer.

---

## What NOT to Do

| Bad behavior | Why it's dangerous |
|---|---|
| See a Dockerfile, immediately suggest `VOLUME` | The server may not run in Docker locally |
| See docker-compose.yml, suggest adding volumes | docker-compose may only run infrastructure, not the app |
| Find a missing config and assume it's a bug | It may be intentionally absent because it's not needed |
| Suggest "best practice" improvements unprompted | Unnecessary changes confuse beginners and can introduce real bugs |
| Stop researching after finding the first related file | The first file is not the full picture — trace the complete flow |
| Offer a fix before confirming the problem is real | Fixing non-existent problems wastes time and creates new problems |

---

## The Standard

Before every suggestion, ask yourself:

1. **Did I trace the full code path?** Not just one file — the whole flow.
2. **Do I understand the runtime environment?** Where does this code actually run?
3. **Would a real developer actually hit this problem?** In normal usage, not edge cases.
4. **Am I solving a real problem or a theoretical one?**

If the answer to any of these is "no" — keep investigating before responding.

---

## Why This Matters

create-tigra exists to help developers who are learning to code with AI assistance. These developers will trust your suggestions without pushback. A confident but wrong suggestion — like adding a Docker volume for a service that doesn't run in Docker — will send them down a rabbit hole debugging something that was never broken. **Your job is to understand what actually works and why, not to guess based on patterns.**
