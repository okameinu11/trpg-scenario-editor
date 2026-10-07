# 原本の書き方（body.md / data.json / thumb.js）

完成品のJSON（アプリの書き出し形式）は道具が作る。ここで書くのは、その元になる原本である。
アプリの書き出し形式に寄せてあるが、画像の指定（`avatar`・`thumbnail`）と `meta` だけは原本にしか無い。

## 目次

1. body.md
2. data.json の全体
3. meta
4. npcs
5. infos
6. scenes
7. basicInfo / faqs / backMatter
8. 画像（avatar・thumbnail・thumb.js）

## 1. body.md

本文そのもの。記法は `docs/01_要件定義書.html` §4 が正。ここには段落の切り方の要点だけを書く（lint が見るのもここ）。

- **段落は空行1つで区切る。** 空白だけの行は空行にならない。
- **ブロックの記法は段落の先頭にだけ書く。** `[判定:…]`・`[情報:…]`・`[セリフ:…]`・`[NPC:…]`・`[DL]` などを段落の2行目以降に書くと、変換されず記号のまま出る。
- **見出しは `#` と `##` の2段だけ。** 見出しの行の直後に空行を入れる（入れないと次の行まで見出しになる）。`###` は使えない。
- **`>>` は1つの段落に1つだけ。** `>>` より後ろはすべて右の段に入る。右の段に2つ書きたいときは、空行のあとに `>>` だけの段落を続ける（直前の本文の右に積まれる）。
- **判定とSANの結果行は `- 段階: 本文` で、区切りは半角の `:`。** 全角の `：` で書いた行は、プレビューから黙って消える。結果の続きは次の行に書いてよい（次の `-` までが1項目）。
- **情景描写の `>` は段落の先頭に1つだけ。** 2行目以降は `>` を付けずに続ける。
- **`[場面図]`・`[場面図:場面名]`・`[目次]` は、その行だけの段落にする。**
- 文字色 `{赤:…}` は1行の中で閉じる。

章の並びの型（既存サンプルの形。題材に合わせて変えてよい）:

```
[目次]

# DL向け：シナリオの背景      ← CoC は「KP向け：…」。場面カードは inDiagram:false
[DL] この章は…               ← 真相・目的・流れ（[場面図]）・進行の目安・HO・登場人物（[NPC:…]）
# 導入：…
# （調査の場面がいくつか）       ← [探索:場所] と、項目と同じ名前の ## 小見出し
# 幕間：…                     ← 状況が動く出来事（[場面図:幕間：…] で先の分岐だけを描く）
# クライマックス：…
# エンディングA：… / B / C
```

## 2. data.json の全体

```json
{
  "meta": { … },
  "id": "sample-coc6-muteki",
  "title": "霧笛の鳴る島",
  "system": "coc6",
  "thumbnail": { "title": "霧笛の鳴る島", "subtitle": "クトゥルフ神話TRPG 第6版 サンプルシナリオ" },
  "npcs": [ … ],
  "infos": [ … ],
  "scenes": { "nodes": [ … ], "edges": [ … ] },
  "basicInfo": { "items": [ … ] },
  "faqs": [ … ],
  "backMatter": { "sections": [ … ], "rights": "…" }
}
```

- `id` は slug と同じにする。読み込むと同じ id のシナリオを上書きする（`merge`）ので、利用者のシナリオとぶつからない名前にする。
- `system` は `GAME_SYSTEMS` のキー（`emoklore` / `coc6`）。

## 3. meta

原本にだけある管理用の欄。アプリには渡らない。

| 欄 | 意味 |
|---|---|
| `builtWith` | 作成または追従を終えたときのアプリの版（`build.appVersion`）。次の追従で「どの版より新しい変更を見るか」の起点になる。点検だけでは更新しない |
| `seed` | 画像を描く乱数の種。変えると絵が変わる。新規なら日付などの数字を決めて固定する |
| `avatarPattern` | 立ち絵の模様の既定（`bubbles` / `waves` / `rings` / `grid` / `none`）。NPCごとに `avatar.pattern` で上書きできる |
| `targetLength` | 本文の目標字数（空白を除く）。9割に届かないと lint が警告する |
| `premise` | `{ "舞台": "…", "怪異": "…", "結末の型": "…" }`。次に新しいサンプルを書くとき、既存のものと重ならないかを本文を読まずに確かめるための要約。無いと lint が警告する |
| `literalAllow` | プレビューに記号のまま出てよい文字列。記法の説明を TIPS に書くとき（例: `"[場面図:場面名]"`）に足す |
| `allowSkills` | 技能一覧に無いが、判定に使ってよい名前（オリジナルの判定名など） |

## 4. npcs

```json
{
  "id": "npc-nagisa",
  "name": "浜野渚",
  "color": "#2563eb",
  "avatar": { "initial": "渚", "from": "#1e3a8a", "to": "#38bdf8", "pattern": "waves" },
  "status": { "age": "21", "gender": "女性", "occupation": "大学生", "str": "9", …, "skills": ["水泳:60"], "emotions": [] },
  "memos": [ { "title": "背景", "body": "…" }, { "title": "シナリオ上の役割", "body": "…" } ]
}
```

- `id` は `npc-<ローマ字>`。場面カードの `npcIds` から引く。**綴りの誤りに注意**（lint が見つける）。
- `name` は本文の `[セリフ:名前]`・`[NPC:名前]` と完全一致。名前に `/` は使えない。
- `color` は `#rrggbb` だけ。セリフの文字色になる。白い紙で読める濃さにする（INLINE_COLORS の6色と同じくらい）。
- `status` のキーはシステムで違う（[systems.md](systems.md)）。値は文字列で書く。`skills` は `"技能名:値"` の配列。
- `memos` は2件以上にすると、NPCカードとNPC管理の見本になる。「背景」「シナリオ上の役割」「主要なセリフ」などに分ける。

## 5. infos

```json
{ "id": "info-diary", "title": "古い日記の切れ端", "target": "観察眼に成功した共鳴者", "body": "…" }
```

- `title` は本文の `[情報:題名]` と完全一致。
- `target` は「全員」か、渡す相手（「HO1」「図書館に成功した探索者」など）。空だと「公開対象 未設定」と出る。
- `body` はプレイヤーに渡す文面そのもの。作中の文書の声で書く（`.claude/skills/sample-scenario-write/references/writing-guide.md` §6）。

## 6. scenes

```json
"nodes": [
  { "id": "scene-dl", "title": "KP向け：シナリオの背景", "kind": "other", "summary": "…", "npcIds": [], "inDiagram": false },
  { "id": "scene-intro", "title": "導入：鴎島への招待", "kind": "intro", "summary": "…", "npcIds": ["npc-nagisa"] }
],
"edges": [ { "from": "scene-intro", "to": "scene-port", "label": "" } ]
```

- `title` は本文の `#` 見出し（1行目）と完全一致。これで場面カードと本文がつながる。
- `kind`: `intro` / `investigate` / `event` / `combat` / `climax` / `ending` / `other`。
- `label` は分岐の条件。分岐する接続にだけ書く（一本道の接続に書くと図がうるさくなる）。
- 接続は輪にできない（アプリが黙って捨てる。lint が見つける）。
- 座標（`x`・`y`）は書かない。アプリが自動で並べる。

## 7. basicInfo / faqs / backMatter

```json
"basicInfo": { "items": [
  { "kind": "section", "heading": "概要", "blocks": [
    { "kind": "subheading", "heading": "プレイ人数", "body": "2〜4人" },
    { "kind": "text", "body": "…" },
    { "kind": "level", "label": "難易度", "value": 3, "max": 5, "symbol": "star" }
  ] },
  { "kind": "level", "label": "グロテスク描写", "value": 1, "max": 5, "symbol": "square" }
] },
"faqs": [ { "question": "…", "answer": "…" } ],
"backMatter": { "sections": [ { "heading": "あとがき", "body": "…" } ], "rights": "…" }
```

- 基本情報の形と考え方は `docs/08_シナリオ基本情報設計書.html`、巻末は `docs/09_巻末設計書.html`。
- `symbol`: `star` / `circle` / `diamond` / `square` / `heart` / `triangle`。`max` は1〜10。
- 本文の欄では文字色 `{赤:…}` が使える。
- 各要素の `id` は書かなくてよい（取り込むときにアプリが振る）。

## 8. 画像（avatar・thumbnail・thumb.js）

画像は build のたびに canvas で描く。描く順番は「NPCの立ち絵を配列の順に → サムネイル」で、同じ乱数の並びを共有する。
**NPCの順番を入れ替えると、乱数を使う模様（bubbles）の絵が変わる。**

- 立ち絵: `avatar.initial`（1文字）・`from`／`to`（グラデーションの2色）・`pattern`。512×512。
- サムネイル: `thumb.js` があればそれで描く。無ければ `thumbnail` の指定で描く。1600×900。
  - `thumbnail`: `title`・`subtitle`・`colors`（背景のグラデーション、2色以上）・`motif`（`rain` / `snow` / `stars` / `fog` / `embers` / `none`）・`accent`（副題の色）
- `thumb.js` は関数1つだけのファイル。題名の文字も自分で描く。

  ```js
  // サムネイル：…（何を描いているか）
  (g, W, H, rand, d, util) => {
    // g: CanvasRenderingContext2D / W, H: 1600, 900 / rand(): 0〜1 の乱数（種固定）
    // d: data.json の中身 / util.serif: 明朝のフォント指定
  }
  ```

- 絵を差し替えたい・外部の画像を使いたいときは、`avatarUrl`（NPC）や `basicInfo.thumbnailUrl` に data URL を直接書けば、そのまま使う。
  ただし外部の画像は、権利の確かなものだけにする。
