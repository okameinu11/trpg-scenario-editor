---
name: devenv-setup
description: このリポジトリの開発環境基盤(devenv)のセットアップを完了させる。claude_basement の template/ をコピーした直後、および基盤を更新して再コピーした直後に使う。setup.pl の実行・devenv.config.json のプロジェクトに合わせた作成・CLAUDE.md の仕上げ・動作確認までを行う。リポジトリ直下に CLAUDE.template.md や devenv.config.example.json があれば導入途中の状態であり、このスキルの出番である。
---

# devenv のセットアップ

## いまどの状態か

**最初にこれを判定する。** ユーザーが「セットアップして」と言った時点で、
どこまで済んでいるかは分からない。

| 直下の状態 | 状態 | やること |
|---|---|---|
| `CLAUDE.template.md` がある | コピー直後。未セットアップ | このスキルの手順を全部 |
| `devenv.config.json` に `{{` や「サンプルプロジェクト」が残っている | setup.pl 済み・設定が未調整 | §3 以降 |
| `CLAUDE.md` に `{{...}}` が残っている | 設定済み・CLAUDE.md が未仕上げ | §4 以降 |
| 上のどれでもない | セットアップ済み | 動作確認（§5）だけ行い、その旨を報告 |

`scripts/devenv/` が無ければ、そもそもコピーが済んでいない。
claude_basement の `template/` の中身をこのリポジトリの直下へコピーするよう案内して終了する
（`.claude/` と `.githooks/` は隠しディレクトリなので `cp -r template/. <target>/` のように
末尾のドットが要る）。

## 1. setup.pl を実行する

```bash
perl scripts/devenv/setup.pl --dry-run
```

**出力をユーザーに提示し、了解を得てから本実行する。**
このスクリプトはファイルを作り、適用済みの `*.append` を削除し、`git config` を書き換える。
勝手に進めない。

```bash
perl scripts/devenv/setup.pl
```

Node を使いたい事情がある場合のみ `--hooks node`（既定は Perl。Node 不要）。

## 2. 配線結果を確認する

出力の「コミットゲートの配線」欄を必ず読む。

| 出力 | 対応 |
|---|---|
| `配線しました` / `設定済み` | 不要 |
| `core.hooksPath は既に "…"` | Husky等が握っている。そちらの `pre-commit` に `perl scripts/devenv/check-doc-sync.pl` を足す |
| `既存フックがあるため配線しません` | `.git/hooks/` の独自フックを `.githooks/` へ統合してから配線 |
| `gitリポジトリではないため配線しません` | `git init` 後に再実行 |

`core.hooksPath` はローカル設定で clone には付いてこない。
このリポジトリの README に `git config core.hooksPath .githooks` を書き添えるよう勧める。

## 3. `devenv.config.json` を書く

**ここが最も判断を要する。**

配布されたのは Next.js + Supabase 想定のサンプルである。
**そのまま残すと、存在しないパスを見張る死んだルールになる。**
このリポジトリの実際のディレクトリ構成を確認してから書き直すこと。

決める順序:

1. **`guardedCommands` を先に。** このプロジェクトで「実行されたら取り返しがつかない」
   コマンドは何か（本番DBへの適用、本番デプロイ、force push、データ削除）。
   **ここは安全側に倒してよい。** 止められて困るなら後で外せるが、止め損なった操作は戻せない。
   `reason` には**必ず代替手段を書く**。止められただけでは、エージェントは別の経路で同じことをしようとする。
2. **`syncRules` は最小構成から。** 最初は `docs-index-sync` 1つで十分。育ってから増やす。
3. **`block` は「例外なく言える」ものだけ。** 迷ったら `warn`。
   ブロックが誤検知すると `--no-verify` が常用され、全チェックがまとめて死ぬ。
4. **`warn` の文面は「何をどう直すか」まで書く。** 「確認してください」だけでは受け手が動けない。
   更新不要と判断してよい条件も添える。
5. `feedback.file` は既定のままでよい。

## 4. `CLAUDE.md` を仕上げる

- `{{...}}` を埋める。`{{ARCHITECTURE_OVERVIEW}}` には
  **ディレクトリを見ても分からないこと**を書く（責務の分かれ目・データの流れ・例外的な構造の理由）。
- `{{SYNC_RULES_SUMMARY}}` / `{{GUARDED_COMMANDS_SUMMARY}}` は**書き起こさず、生成した出力を貼る**。

  ```bash
  perl scripts/devenv/check-doc-sync.pl --summary
  ```

  出力は2つの表（ゲート一覧・遮断コマンド一覧）で、それぞれのプレースホルダに対応する。
  手で書き写すと必ず実態からずれる（実際に「10件」と書かれた横で12件走っていた事例がある）。
  `message` の1行目が表の「目的」欄になるので、**設定側の文面を読み手向けに整えること**が
  そのまま一覧の質になる。
- **テンプレートの痕跡（冒頭のHTMLコメント）と、埋めなかったプレースホルダを残さない。**
- **「開発環境の育て方」の節は必ず残す。** このリポジトリで devenv を育てる運用の入口になる。
- 既に別の `CLAUDE.md` があった場合、setup.pl は上書きしていない。
  `CLAUDE.template.md` の各節を既存の構成に合わせて統合する。**同じ内容を二重に書かない。**

## 5. 動作確認する

**省略しない。** 設定しただけで効いていないゲートは、無いより危険である
（「守られている」と誤認したまま作業が進む）。

```bash
perl scripts/devenv/check-doc-sync.pl   # 何も出ずに終われば設定は壊れていない
```

そのうえで、**意図的にルールへ引っかけて block が実際にコミットを止めることを1つ確かめる**。
確認できたら検証用ファイルは必ず片付ける。

フックの動作は、Claude Code を再起動したあと `.claude/logs/` 配下に
日付ごとのログ（`2026-08/agent-actions-2026-08-31.log`）が生成されるかで分かる。生成されない場合は、フックの起動シェルから `perl` が
解決できていない可能性が高い（Windowsでは Perl は Git Bash 内にはあるが、システムPATHには
載っていない）。その場合は `.claude/settings.json` の `command` を
`node .claude/hooks/*.js` に書き換える（Node版は同梱済み）。

## 6. 報告する

- `setup.pl` の結果（実施／触れなかったもの／配線）
- 手で統合が必要なファイルがあればその一覧
- 設定した `syncRules` / `guardedCommands` と、その意図
- **block が実際に止まった証跡**
- 導入した版（`perl scripts/devenv/setup.pl --version`）
- ユーザー側に残る作業（Claude Code の再起動、README への追記など）

## 注意事項

- **既存プロジェクトへの後付けでは、いきなり `block` を増やさない。**
  ルールを作る前に書かれたコードとドキュメントが既にある。全ルールを `warn` で
  しばらく動かし、誤検知が出ないものだけ `block` に上げる。
- git リポジトリでない場合、`syncRules` は何もしない（`git diff` が空を返す）。
  実行記録と危険コマンド遮断は git 無しでも動く。
- 導入後の改善は**このリポジトリの中で**行う（`/devenv-feedback`）。
  大元の claude_basement を直接触ることはしない。
