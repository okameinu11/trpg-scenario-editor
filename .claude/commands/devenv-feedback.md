---
description: 開発環境の摩擦をこのリポジトリで直し、その内容を devenv.feedback.json に記録する
---

# 開発環境の改善

補足（任意）: `$ARGUMENTS`

## 目的

このリポジトリで起きた**開発環境の摩擦**を、その場で直す。そして直した内容を
持ち帰り可能な形で記録する。**プロダクトの改善ではない。**

開発環境は、それを実際に使っているこのリポジトリの中で育てるのが基本である。
大元の基盤（claude_basement）へ反映するかどうかは、ユーザーが任意のタイミングで
記録ファイルを持ち帰って別途判断する。**このコマンドは大元には触れない**
（claude_basement をどこに置いているかは環境ごとに違うため、パスにも依存しない）。

## 手順

### 1. 摩擦を洗い出す

`devenv-improver` サブエージェントを呼び出す。`$ARGUMENTS` に補足があれば、
その観点を重点的に見るよう伝える。

**摩擦が無ければ何もしない。** 「今回は開発環境の摩擦はありませんでした」と報告して終了する。
中身の無い記録が溜まると、本当に見るべき記録が埋もれる。

### 2. 直す

洗い出した各項目について、**このリポジトリの devenv を実際に直す**。

| 摩擦 | 直す場所 |
|---|---|
| ブロッキングチェックの誤検知 | `devenv.config.json` の該当ルール（`level` を下げる・`exclude` を足す・glob を絞る） |
| 検知漏れ | `devenv.config.json` にルールを足す |
| 警告文が分かりにくい | 該当ルールの `message` |
| ルールの所在が不明・重複 | `CLAUDE.md` / `docs/` |
| 手作業の反復 | `.claude/skills/` にスキルを足す |
| 遮断の過不足 | `devenv.config.json` の `guardedCommands` |

**変更前に、何をどう直すかをユーザーに提示して了解を得ること。** 開発環境の変更は
以後の全作業の前提を変える。勝手に進めない。

**まず `devenv.config.json` で表現できないかを疑うこと。** 新しいスクリプトやフックを
足すのは最後の手段である。ファイルが増えるほど、この基盤は壊れやすくなる。

直したら、**そのルールが意図どおりに効くことを実際に確かめる**
（意図的に引っかける／引っかからないことを確認する）。

直さないと判断した場合は、その理由も記録に残す（`status: "proposal-only"`）。

### 3. 記録する

`devenv.config.json` の `feedback.file`（既定 `devenv.feedback.json`）に追記する。
ファイルが無ければ `devenv.feedback.example.json` を雛形にして作る。

- `project` と `devenvVersion` を埋める
  （版は `perl scripts/devenv/setup.pl --version` で取得）
- `entries` に**1摩擦1エントリ**で追加する。まとめない
  （大元での採否は個別に判断されるため）
- `id` は `YYYY-MM-DD-英小文字ハイフンのスラッグ`。重複判定に使うので使い回さない

```json
{
  "id": "2026-08-18-screen-doc-sync-false-positive",
  "date": "2026-08-18",
  "scope": "config",
  "generality": "high",
  "title": "画面の中身を変えただけで screen-doc-sync がブロックした",
  "symptom": "src/app/foo/page.tsx の文言を直しただけのコミットが中断された。エラーは『画面詳細設計書と画面遷移図の両方を更新すること』",
  "cause": "trigger.diffFilter が既定の ACMR のままで、追加・削除以外でも発火していた",
  "localChange": "devenv.config.json の screen-doc-sync に \"diffFilter\": \"AD\" を追加。既存画面の編集で発火しないことを確認した",
  "proposal": "設定サンプルの screen-doc-sync に diffFilter: AD を明示し、docs にも『AD を使う場面』を書く",
  "rationale": "画面を持つプロジェクトなら同じ設定を書くため、同じ誤検知が起きる",
  "status": "applied-locally"
}
```

**`symptom` は再現できる具体性で書く。** ファイル名・コマンド・実際のエラー文言を含める。
「使いにくい」のような書き方では、持ち帰っても採否を判断できない。

### 4. 報告

- 直した内容と、効くことを確認した方法
- 記録したエントリの `id` と要約
- 大元へ持ち帰るときの手順を1行添える:
  「`devenv.feedback.json` を claude_basement へコピーし、そこで `/devenv-import` を実行してください」

## 注意事項

- `generality: "low"`（このプロジェクト固有）の項目も記録してよい。持ち帰り時に
  「大元には入れない」と判断する材料になる。**判断のための情報を捨てない。**
- 記録ファイルはコミットする。開発環境の変更履歴として意味を持つため。
