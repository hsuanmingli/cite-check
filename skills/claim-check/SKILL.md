---
name: claim-check
description: Check whether the cited sources in a markdown or text document actually say what the document claims. For every claim with a URL (inline link, [^footnote], or bare URL), fetches the page and reports found / partial / not found / unreachable with the matching sentence from the source. Use when the user asks to "check the citations", "verify sources", "fact-check this report against its links", "did the agent make up these references", or before publishing an AI-written document that cites URLs.
---

# claim-check

Catch claims whose cited source does not support them: made-up citations, wrong numbers, invented quotes, dead links.

The work is split in two:

1. **A deterministic script** fetches every cited page and scores each claim. Same input, same output.
2. **You (Claude) review only the rows the script could not settle** — `partial` and `not found` — because paraphrases defeat word matching.

## Step 1 — run the script

```bash
node "<skill-dir>/scripts/claim-check.mjs" <document> --json > /tmp/claim-check.json
```

`<skill-dir>` is the directory containing this SKILL.md. Node 18+ is required; there are no dependencies and no API keys. Optional: `--timeout 30` (seconds per page).

The script finds claims in three forms:

- inline link: `Python is a general-purpose language ([source](https://...)).`
- footnote: `...built from 1887 to 1889.[^1]` with `[^1]: https://...`
- bare URL: `... absolute requirement (https://...).`

If a sentence contains quoted text (`"..."`, `“...”`, `「...」`), the quote must appear on the page verbatim (case, whitespace and quote style are normalized). Every number in a claim must appear in a passage of the page that is about the claim; otherwise the verdict is capped at `partial`.

If the script prints `No cited claims found`, tell the user and stop. Do not invent claim/URL pairs.

## Step 2 — review the unsettled rows

For each result in the JSON:

| Script verdict | What you do |
|---|---|
| `found` | Keep. Do not re-check. |
| `unreachable` | Try once with WebFetch. If it loads, judge it like `not found` below. If not, keep `unreachable` and give the reason (HTTP 404, timeout, PDF). |
| `partial` / `not found` | Read the `snippet` and `notes`. If the snippet is not enough, WebFetch the URL and look for the claim. Decide the final verdict with the rules below. |

Rules for your review:

- **Upgrade to `found` only if you can quote a sentence from the page that states the same fact.** Put that sentence in the "source sentence" column. Paraphrase is fine; a different fact is not.
- **A number note means something.** If `notes` says a number was not found near the matching text, check the page for that number. A wrong number is `partial` at best, and say which number is wrong.
- A missing quote (`quoted text not on page`) stays `not found` unless the exact wording is on the page. Close-but-different wording is `partial` — the quote is misquoted.
- The page saying something *related* (same topic, different claim) is `not found`.
- Never upgrade based on what you know about the topic. The question is only "does this page say it", not "is it true".
- Mark every row you changed with `(reviewed)` after the verdict so the user can tell script verdicts from yours.

## Step 3 — report

Write the report next to the document as `<document-name>.claim-check.md`, and print the same table in the chat:

```markdown
# Claim check: <document>

Checked N citations on YYYY-MM-DD. found: a · partial: b · not found: c · unreachable: d

| # | Claim | URL | Verdict | Source sentence | Notes |
|---|---|---|---|---|---|
| 1 | ... | ... | ✅ found | "<sentence from the page>" | |
| 2 | ... | ... | ❌ not found (reviewed) | closest: "<sentence>" | page names Guido van Rossum, not Linus Torvalds |
```

Verdict icons: ✅ found · 🟡 partial · ❌ not found · ⚠️ unreachable.

After the table, list the `not found` and `partial` rows again in one short line each, worst first, so the user knows what to fix. Do not rewrite the user's document unless asked.

## Limits (say so if relevant)

- Claims without a URL are not checked. This skill checks citations, not general truth.
- PDFs and pages that need JavaScript or a login come back `unreachable`.
- Word matching is weakest on paraphrases and on Chinese/Japanese/Korean text; that is what Step 2 is for.
