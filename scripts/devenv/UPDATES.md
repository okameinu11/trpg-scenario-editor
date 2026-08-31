# devenv 適用記録

大元の基盤（claude_basement）から取り込んだ内容と、このプロジェクトで**取り込まなかった判断**を残す。
理由が残らないと、次の更新のたびに同じ判断をやり直すことになる。

---

## v4.0.0 — 2026-08-31（初回導入）

`perl scripts/devenv/setup.pl` を実行し、`CLAUDE.md` / `devenv.config.json` /
`devenv.feedback.json` / `.claude/settings.json` を生成。
`git init` 後に `core.hooksPath = .githooks` を配線した。フック実行系は Perl（Node不要）。

### このプロジェクトの前提

- アプリ本体は `index.html` 1枚（約3,000行）。ビルド工程・依存パッケージ・テストランナーが無い。
- GitHub Pages（publicリポジトリ）での公開を予定している。
- `knowledge/` にTRPGルールブック由来の資料がある。

### 配布サンプルから変更した点

| 対象 | 変更 | 理由 |
|---|---|---|
| `syncRules` | 全面的に書き直し | 配布サンプルは Next.js + Supabase 前提で、`src/app/**/page.tsx`・`db/migrations/**` 等を監視する。このプロジェクトには存在せず、**8件中7件が発火しない死んだルール**だった。 |
| `knowledge-index-sync` の `diffFilter` | `ACDMR` → `ADR` | サンプルは内容の修正だけでも目次更新を要求するが、メッセージは「追加・削除・移動したら」と書かれており実態と食い違う。毎回鳴ると `--no-verify` を誘発するため、追加・削除・改名に限定した。 |
| `guardedCommands` | 3件 → 9件 | 単一ファイル構成のため `index.html` の消失が致命的であること、および公開が一方通行の操作であることを踏まえ、`destroy-app-file` / `git-remote-add` / `gh-repo-publish` 等を追加した。いずれも日常的には使わないコマンドで、遮断しても通常作業を妨げない。 |
| `auditLog.extraLabels` | `DB-WRITE` / `DB-KEY` → `APP-EDIT` / `PUBLISH` | データベースを持たないプロジェクトのため、サンプルのラベルは発火しない。 |

### 取り込まなかったもの

- **`no-native-dialogs` ルール（ブラウザ標準の `alert` / `confirm` / `prompt` を禁止）**
  `index.html` は既に `confirm()` を多用しており（シナリオ削除、新規作成時の上書き確認など）、
  単一ファイル構成でダイアログコンポーネントを持たない。
  ルールを入れると既存コードの変更のたびに鳴り続け、警告全体が無視されるようになる。
  独自ダイアログを実装する方針が決まった時点で再検討する。

- **`frontend-quality-reminder` ルール（UIコンポーネント変更時に frontend-design スキルを想起させる）**
  このプロジェクトでは `index.html` がUIそのものであり、あらゆる変更で発火してしまう。
  `app-doc-sync`（warn）が同じ役割を部分的に担うため見送った。

- **`knowledge/external-tool-formats/` への生データ集約**
  `knowledge-doc-writer` スキルは生データサンプルを専用フォルダに集約するよう求めているが、
  既存の `reference/` `research/` はドメイン別に整理されており、解説HTMLと生データが近接している方が辿りやすい。
  ファイル数が増えて見通しが悪くなった時点で再検討する。

### 同時に実施した移行作業

`docs/` と `knowledge/` の全 `.md`（15ファイル）を HTML へ移行した。
移行時に元資料の以下の不備を修正している。

- 旧 `knowledge/INDEX.md` のリンク切れ（`reference/emoklore-character-data-format.md` は実際には `research/` にあった）と記載漏れ（`coc6th/` `coc7th/` 地雷チェックシートが未掲載）
- `research/emoklore-character-data-format.md` を削除。内容が `reference/cocofolia-emoklore-character-pawn-data-format.json` と完全一致していたため（二重管理の解消）
- TeX記法の混入（`$D3$`、`$\div 2$`、`$\times$` 等）と、1行に潰れていたMarkdown表の復元
- エモクロア技能一覧の誤字（韓国語文字「의」の混入）

エモクロアTRPGの同一ルールセットを扱う資料が4件重複していたため、
角度ごとに整理し（判定 / 能力値・生命維持 / データ構造 / 概観）、重複箇所は相互リンクに置き換えた。
情報の削除は行っていない。

### 動作確認の記録

- `perl scripts/devenv/check-doc-sync.pl` — ステージ無しで無出力・exit 0
- ブロックの実証 — 目次を更新せずにドキュメントを追加してコミットを試み、`docs-index-sync` により中断されることを確認（コミットは作成されなかった）
- 遮断の実証 — 22パターンで検証し全て期待どおり。`git push --force-with-lease`、`echo x >> index.html`、`.gitignore`、`rm -rf node_modules` はいずれも誤検知なし
- セットアップ中に `APP-EDIT` ラベルの誤検知を1件発見し、`sed -i` / `tee` / リダイレクトのみを拾うようパターンを狭めた

### `knowledge/` のリポジトリ除外（2026-08-31、初回コミット前）

TRPGルールブック由来の資料を含むため、`knowledge/` を `.gitignore` で除外した。
**まだ1件もコミットしていない段階で除外したので、git の履歴にも残っていない。**
ローカルの作業ディレクトリには残っており、エージェントは従来どおり参照できる。
アプリ本体（`index.html`）はこのフォルダに依存しないため、動作には影響しない。

この除外に伴い、以下を連動して修正した。除外だけして放置すると、
「守られているつもりで実際は何も検査していない」設定が残ることになる。

| 対象 | 対応 | 理由 |
|---|---|---|
| `knowledge-index-sync` ルール | **撤去** | gitignore されたファイルは `git diff` に現れないため、このルールは永久に発火しない。設定しただけで効いていないゲートは、無いより危険（「守られている」と誤認したまま作業が進む）。 |
| `md-draft-leftover` の対象 | `knowledge/**/*.md` を除外し `docs/` のみに | 同上。 |
| `git-remote-add` の理由文 | `knowledge/` が公開されるという記述を、除外済みである前提に書き換え | 実態と食い違う警告文は、読み手の判断を誤らせる。 |
| `docs/00_INDEX.html` | `../knowledge/INDEX.html` へのリンクを解除し、リポジトリ外である旨の注記を追加 | GitHub Pages で公開した際に404になるため。 |
| `docs/01_要件定義書.html` | `../knowledge/test.html` へのリンクを解除 | 同上。 |
| `CLAUDE.md` | 参照ルール・役割分担表・公開範囲の節を更新し、ルール表を貼り直し | clone した環境に `knowledge/` は無いため、その前提を明記する必要がある。 |

**`knowledge/` を再びリポジトリに含める場合は、`knowledge-index-sync` ルールの復活も併せて検討すること。**
撤去した設定は本ファイルの履歴から復元できる。
