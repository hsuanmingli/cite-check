# claim-check

A Claude Code skill that checks whether the sources cited in a document actually say what the document claims.

AI agents write reports full of links. Some links are dead, some pages say something else, and some quotes were never written by anyone. `claim-check` fetches every cited page and tells you, claim by claim, whether the source backs it up.

[繁體中文說明在下方](#繁體中文)

## What it does

For every sentence that cites a URL, the skill reports one of:

| Verdict | Meaning |
|---|---|
| ✅ found | The page states this claim. The matching sentence is shown. |
| 🟡 partial | The page covers part of it, or a number in the claim does not match. |
| ❌ not found | The page does not say this, or a quoted sentence is not on the page. |
| ⚠️ unreachable | 404, timeout, PDF, or a page that needs JavaScript or a login. |

It works in two passes:

1. A zero-dependency Node script fetches each page and scores each claim (exact match for quotes, word overlap for the rest, and a check that every number in the claim appears near the matching text).
2. Claude reviews only the `partial` and `not found` rows, to catch paraphrases the script misses. Rows Claude changes are marked `(reviewed)`.

No API keys, no paid services. Only Node 18+.

Supported citation formats: inline links `[text](url)`, footnotes `[^1]` + `[^1]: url`, and bare URLs. Claims without a URL are not checked.

## Install

```bash
git clone https://github.com/hsuanmingli/cite-check ~/claim-check-skill
mkdir -p ~/.claude/skills
ln -s ~/claim-check-skill/skills/claim-check ~/.claude/skills/claim-check
```

To install for one project only, link it into that project's `.claude/skills/` instead. You can also copy the folder rather than symlink it.

## Use

In Claude Code:

```
check the citations in report.md
```

Claude runs the script, reviews the unclear rows, prints the table, and saves `report.claim-check.md` next to your file.

The script also runs on its own:

```bash
node ~/claim-check-skill/skills/claim-check/scripts/claim-check.mjs report.md --out report.claim-check.md
```

Options: `--json` for machine-readable output, `--timeout 30` for seconds per page.

## Example

Input ([examples/02-fake-citation.md](examples/02-fake-citation.md)), with four planted errors:

```markdown
- Python was created by Linus Torvalds at Bell Labs in 1975 ([source](https://en.wikipedia.org/wiki/Python_(programming_language))).
- The Eiffel Tower was constructed from 1887 to 1889 and is 512 metres tall.[^1]
- RFC 2119 states that "SHOULD means the item is optional and may be ignored at will" (https://www.rfc-editor.org/rfc/rfc2119.txt).
- A 2025 study found 73% of agents fabricate citations ([study](https://example.com/this-study-does-not-exist-2025)).
```

Script output, trimmed to the key columns (full report with overlap scores and source sentences: [examples/02-fake-citation.claim-check.md](examples/02-fake-citation.claim-check.md)):

| # | Claim | Verdict | Notes |
|---|---|---|---|
| 1 | Python was created by Linus Torvalds at Bell Labs in 1975. | ❌ not found | numbers not found near matching text: 1975 |
| 2 | The Eiffel Tower ... is 512 metres tall. | 🟡 partial | numbers not found near matching text: 512 |
| 3 | RFC 2119 states that "SHOULD means ... ignored at will". | ❌ not found | quoted text not on page |
| 4 | A 2025 study found 73% of agents fabricate citations. | ⚠️ unreachable | HTTP 404 |

All four errors are caught. The accurate sample ([examples/01-accurate.md](examples/01-accurate.md)) comes back 3/3 found.

## Limits

- It checks "does this page say it", not "is it true".
- PDFs and JavaScript-rendered pages come back `unreachable`.
- Word matching is weak on paraphrases and on Chinese/Japanese/Korean text. In [examples/03-zh-footnotes.md](examples/03-zh-footnotes.md) the script marks one correct Chinese claim `partial` and another `not found`; the Claude review step is there to fix exactly this.

## License

MIT

---

## 繁體中文

`claim-check` 是一個 Claude Code skill。它檢查文件裡引用的來源，是否真的寫了文件宣稱的內容。

AI agent 寫的報告常附很多連結。有些連結失效。有些頁面講的是別的事。有些引言根本不存在。這個 skill 逐條抓取引用頁面，告訴你每條主張有沒有來源支撐。

### 判定結果

| 判定 | 意思 |
|---|---|
| ✅ found | 頁面寫了這條主張。附上對應原句。 |
| 🟡 partial | 頁面只寫了一部分，或主張裡的數字對不上。 |
| ❌ not found | 頁面沒寫這件事，或引號內的句子不在頁面上。 |
| ⚠️ unreachable | 404、逾時、PDF、或需要 JavaScript／登入的頁面。 |

運作分兩段：

1. 零依賴的 Node script 抓每個頁面，替每條主張打分。引言做精確比對，其他做詞彙重疊比對。主張裡的每個數字，都要出現在相關段落附近。
2. Claude 只複查 `partial` 和 `not found`，補抓 script 漏掉的改寫句。Claude 改過的列會標 `(reviewed)`。

不需要 API key，不用付費服務。只需要 Node 18 以上。

支援的引用格式：行內連結 `[文字](網址)`、註腳 `[^1]` 加 `[^1]: 網址`、裸網址。沒附網址的主張不檢查。

### 安裝

```bash
git clone https://github.com/hsuanmingli/cite-check ~/claim-check-skill
mkdir -p ~/.claude/skills
ln -s ~/claim-check-skill/skills/claim-check ~/.claude/skills/claim-check
```

只想裝在單一專案，就改連到該專案的 `.claude/skills/`。也可以直接複製資料夾，不用 symlink。

### 使用

在 Claude Code 裡說：

```
幫我檢查 report.md 的引用
```

Claude 會跑 script、複查不確定的列、在對話印出表格，並在原檔旁存 `report.claim-check.md`。

Script 也可以單獨跑：

```bash
node ~/claim-check-skill/skills/claim-check/scripts/claim-check.mjs report.md --out report.claim-check.md
```

選項：`--json` 輸出 JSON，`--timeout 30` 設定每頁秒數。

### 範例

[examples/02-fake-citation.md](examples/02-fake-citation.md) 埋了四個錯誤：假作者、錯的數字、捏造的引言、失效連結。Script 四個都抓到。正確範例 [examples/01-accurate.md](examples/01-accurate.md) 三條全部 found。

### 限制

- 它只查「頁面有沒有寫」，不查「事情是不是真的」。
- PDF 和 JavaScript 渲染的頁面會回 `unreachable`。
- 詞彙比對對改寫句和中日韓文字較弱。[examples/03-zh-footnotes.md](examples/03-zh-footnotes.md) 裡，兩條正確的中文主張被 script 判成 `partial` 和 `not found`。Claude 複查這一步就是為了修這種情況。
