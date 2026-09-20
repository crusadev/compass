---
name: Map Domain
description: Write or refresh the compass file for one domain, making its source of truth, duplicated logic and downstream effects explicit
---

## Map Domain

Produce `docs/context/<domain>.md`: a short, cited note that makes a domain's
architecture explicit, so a change in one place does not silently break another.

Read `tools/context/README.md` first for the format and the reasoning behind it.

### 1. Inventory

```bash
node tools/context/scan-schema-usage.mjs
node tools/context/scan-change-coupling.mjs
```

Read the two reports in `docs/context/_generated/` for this domain's tables and
files. They are evidence, not conclusions. Treat the coupling report with care:
a domain shipped recently ranks high because it churned, not because it is
tangled.

### 2. Find the boundary

`git ls-files | grep -iE '<domain words>'` beats guessing from folder names.
Then follow imports outward from the files that own the domain's tables.

Watch for near-duplicate filenames across packages. Two files with the same
basename in `backend/` and `frontend/` is the single strongest signal of
duplicated business logic in this repo, and it is what you are here to find.

### 3. Answer the five questions

Answer all five, in order, before writing anything:

1. What does this domain own? Which tables and columns is it the source of truth for?
2. What is the non-obvious business logic - formulas, gates, invariants - where does it live, and is it duplicated anywhere else?
3. What outside this domain reads or writes its data?
4. If I change X here, what else has to change in the same commit?
5. What is deprecated but load-bearing, and must never be deleted?

For question 2, diff suspected duplicates with comments stripped. Identical
comments hide diverged code, and diverged comments hide identical code. Both
have happened here.

**Cite the binding, not the expression.** When a condition decides something,
read the name it is assigned to before you describe what it means. An expression
like `items.some(i => i.allocations.length > 0)` looks like a test for one thing
and is frequently bound to a variable named for something else entirely - a
guard, a cache check, a retry condition. The author's name for it usually
carries the answer. A claim citing a bare expression is a claim you have not
finished checking.

**Treat anything you already believe as unverified.** Prior summaries, memory,
CLAUDE.md and a previous compass file are leads, not evidence. The same orders
pilot inherited a confident one-line summary that inverted the real rule and
reproduced it. Re-derive every claim from the code in front of you, and when the
code contradicts a standing note, say so explicitly in the output so the note
gets fixed rather than quietly worked around.

### 4. Write it

One file, `docs/context/<domain>.md`, matching the template in
`tools/context/README.md`. Hard cap 35 lines.

Cite a repo-relative path for every claim, with `:line` where a specific line is
the authority. Bare filenames are rejected when ambiguous, which is deliberate:
if you cannot say which `pricing.ts` you mean, neither can the next reader.

### 5. Critique before you finish

```bash
node tools/context/check-context.mjs
```

That proves the citations resolve. It does not prove the claims are true, so
also re-check by hand:

- Every count you wrote ("14 exports drift unguarded") - recount it.
- Every claim about behaviour - find the line that demonstrates it.
- Every claim you inferred rather than read. If the repo does not prove it, say
  where the authority actually lives instead of citing a file that merely looks
  like it.
- **Every rule you stated as absolute.** If the function takes options, read what
  each branch does before writing the rule down. The classic failure is reading
  the default branch of an optional parameter and writing it up as the whole
  rule. A rule stated without its branches is worse than no rule, because it
  reads as settled.

Cut anything you cannot cite. A confident sentence with no source is worse than
a missing one, because the next agent will believe it.

### Output

Report: the compass file path, the duplicated logic found, the zombie columns
found, and any claim you could not verify.
