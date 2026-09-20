---
name: Audit Domain
description: Re-derive compass claims whose cited code has changed, and resolve disagreements between compass files
---

## Audit Domain

Writing the compass files found three production defects. None came from a
scanner. Each came from the same thing: someone re-deriving a fact and finding
it did not match what was written down.

This skill makes that recur instead of happening once. It does not write new
compass files - `/map-domain` does that. It checks the ones that exist against
the code as it is now.

Argument: a domain name, or nothing for every domain with outstanding work.

### 1. Find what needs re-checking

```bash
node tools/context/check-context.mjs          # broken citations, and stale claims
node tools/context/scan-claim-conflicts.mjs   # two files, one line, different claims
```

Three queues, in descending value:

- **Stale claims.** `unverified since <file> last changed` means the cited code
  moved after the claim was written. The claim may still be true; nothing has
  looked. This is the queue that refills on its own as the codebase changes.
- **Claim conflicts.** Two compass files anchored on the same line saying
  different things. One is wrong, or one duplicates a fact the other owns, or a
  citation is imprecise. All three are worth fixing.

### 2. Re-derive, do not re-read

For each item, open the code and work out what it does now. Do not start from
the compass file and look for confirmation - that is how a wrong claim survives
a review. Start from the code and see whether the sentence matches it.

The failure modes that have actually produced wrong claims here:

- A rule stated absolutely where the function has branches.
- A claim citing an expression rather than the name it is bound to.
- A claim inherited from a comment in the source. `computeStockLevelPricing`
  says "All totals are scaled by quantity"; one of its four outputs is not, and
  a compass file repeated the comment rather than the code.
- A count that was true when written.

### 4. Separate the two kinds of finding

This is the important part.

- **The doc is wrong.** Fix the compass file. Keep it under 35 lines.
- **The code is wrong.** Do NOT fix it. Record it in the compass file as what
  the code actually does, and report it. A defect found while auditing
  documentation is still a defect someone has to decide about, and deciding is
  not yours: see "Decisions that are not yours to make" in CLAUDE.md.

Every production defect this pipeline has found came out of the second
category. Treating them as documentation bugs to smooth over would have lost
all three.

### 5. Verify

```bash
node tools/context/check-context.mjs
```

Zero broken citations. Stale warnings for claims you re-derived should be gone
once the compass file is committed.

### Output

Report, separately:

1. Claims re-derived, and which were wrong.
2. Suspected CODE defects, with file:line and what you expected instead. Say
   plainly that you did not fix them.
3. Anything you could not verify.
