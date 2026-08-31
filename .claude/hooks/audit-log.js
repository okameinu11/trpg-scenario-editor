// PreToolUse hook (Bash): エージェントが実行したコマンドを記録する。
//
// ## なぜ必要か
//
// 権限プロンプトを自動承認する運用（オートモード）にすると、「何が実行されたか」を
// 目で追う機会が無くなる。コードの変更は git で追えるが、**Bashコマンドそのものは
// git に残らない**。とくに痕跡が残りにくいのは次のもの。
//
//   - DBへの書き込み（管理者キーで権限制御を迂回する検証スクリプト）
//   - ファイルの一括置換を行う `node -e` / 使い捨てスクリプト
//   - git commit / git rm などの履歴操作
//
// このフックは**何もブロックしない**（常に exit 0）。記録だけを行う。
// ブロックが必要な操作は guard-commands.js が別に担当する。
//
// 記録先は既定で `.claude/logs/2026-08/agent-actions-2026-08-31.log` のように
// 日付ごとに分かれる（`auditLog.rotate` で変更可能）。成果物ではないので
// .gitignore に入れること。記録を読む手順は .claude/skills/audit-log-check を参照。

const fs = require('fs');
const path = require('path');
const { loadConfig, auditLogPath } = require('../../scripts/devenv/config');

const config = loadConfig();
const auditConfig = config.auditLog || {};

if (auditConfig.enabled === false) process.exit(0);

const LOG_FILE = auditLogPath(config);

// テーブル参照。スキーマ修飾（public.users）と引用符（"users"）を許す。
// これが無いと、最も記録したい本物の書き込み（psql で public.xxx を更新する等）を
// 取りこぼす。検知漏れは誤検知より危険で、「印が無い＝安全」と誤読させる。
const TABLE_REF = String.raw`(?:"[^"]+"|\w+)`;
const QUALIFIED_REF = String.raw`${TABLE_REF}\s*\.\s*${TABLE_REF}`;

// 生SQLによるデータ・スキーマ変更。
//
// TRUNCATE を裸で拾わないのは、Tailwind の `truncate` クラスに誤爆するため。
// TSXを1枚書くたびにSQLの印が付くと、印が目印として機能しなくなる。
// そこで `TRUNCATE TABLE` かスキーマ修飾されたテーブル名が続く形だけを対象にする。
const SQL_WRITE = String.raw`\b(?:INSERT\s+INTO\b|UPDATE\s+${TABLE_REF}(?:\s*\.\s*${TABLE_REF})?\s+SET\b|DELETE\s+FROM\b|TRUNCATE\s+(?:TABLE\b|${QUALIFIED_REF})|DROP\s+(?:TABLE|SCHEMA|DATABASE)\b|ALTER\s+TABLE\b)`;

// 「あとから必ず見返したい」操作。行頭に印を付けて grep で拾えるようにする。
// 印は絞ること。全部に印が付くと目印として機能しなくなる。
const DEFAULT_LABELS = [
  { pattern: String.raw`\bgit\s+(commit|rm|reset|checkout|restore|stash|revert)\b`, label: 'GIT' },
  { pattern: String.raw`\bgit\s+push\b`, label: 'PUSH' },
  { pattern: String.raw`\bnode\s+-e\b`, label: 'INLINE-SCRIPT' },
  { pattern: String.raw`\b(rm|mv|cp)\s+-[a-zA-Z]*[rf]`, label: 'FS' },
  { pattern: String.raw`writeFileSync|unlinkSync|rmSync`, label: 'FS-WRITE' },
  { pattern: String.raw`\b(taskkill|kill\s+-9|pkill)\b`, label: 'PROC' },
  {
    pattern: String.raw`\b(curl|wget|Invoke-WebRequest)\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--data)`,
    label: 'NET-WRITE',
  },
  // ORM経由の書き込みはプロジェクト側で extraLabels に足す
  // （例: supabase-js の .update( / .insert( 等）。
  { pattern: SQL_WRITE, label: 'SQL-WRITE' },
];

// プロジェクト固有の印は devenv.config.json の auditLog.extraLabels で足す。
//   { "pattern": "...", "label": "DB-WRITE", "requires": "...", "unless": "..." }
//
// `requires` / `unless` があるのは、「鍵を使った」だけで「書き込んだ」印を付けると
// 誤検知だらけになるため。読み取り専用のスクリプトにも印が付くと、
// 「見返すべき操作」の目印として機能しなくなる。
const extraLabels = Array.isArray(auditConfig.extraLabels) ? auditConfig.extraLabels : [];

/**
 * ファイルへリダイレクトされるヒアドキュメントの本文を、分類対象から取り除く。
 *
 * エージェントがソースコードを書く手段としてヒアドキュメントは日常的に使われる。
 * 書き込まれる中身に `.update(` や `DELETE FROM` が含まれるだけでDB操作の印が付くと、
 * 印の付いた記録の大半が「ソースを書いただけ」になり、本物が埋もれる。
 *
 * リダイレクトを伴わないもの（`psql <<'SQL'` のように標準入力へ渡して**実行する**もの）は
 * 取り除かない。そちらは実際に実行される中身であり、記録の対象そのものである。
 */
function isFileRedirect(command, markerIndex) {
  const lineStart = command.lastIndexOf('\n', markerIndex) + 1;
  const lineEnd = command.indexOf('\n', markerIndex);
  const header = command.slice(lineStart, lineEnd === -1 ? command.length : lineEnd);
  // `2>&1` のようなfd複製は除く（> の直前が数字、直後が & のもの）
  return new RegExp(String.raw`(?:^|[^0-9<>&])>>?\s*[^&|>\s]`).test(header);
}

function stripRedirectedHeredocs(command) {
  const marker = new RegExp(String.raw`<<-?\s*(['"]?)(\w+)\1`, 'g');
  let result = '';
  let cursor = 0;
  let match;

  while ((match = marker.exec(command))) {
    const tag = match[2];
    const bodyStart = marker.lastIndex;
    const closing = new RegExp(String.raw`\n[ \t]*${tag}\b`).exec(command.slice(bodyStart));
    const bodyEnd = closing ? bodyStart + closing.index : command.length;

    if (isFileRedirect(command, match.index)) {
      result += command.slice(cursor, bodyStart);
      cursor = bodyEnd;
    }
    // 本文の中を次のマーカー探索の対象にしない（入れ子の誤検出を避ける）
    marker.lastIndex = bodyEnd;
  }

  return result + command.slice(cursor);
}

function classify(command) {
  const labels = new Set();

  for (const { pattern, label, requires, unless } of [...DEFAULT_LABELS, ...extraLabels]) {
    try {
      if (!new RegExp(pattern, 'i').test(command)) continue;
      if (requires && !new RegExp(requires, 'i').test(command)) continue;
      if (unless && new RegExp(unless, 'i').test(command)) continue;
      labels.add(label);
    } catch {
      // 設定側の正規表現が不正でも、記録自体は続ける
    }
  }

  return [...labels];
}

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const command = payload?.tool_input?.command;
    if (typeof command !== 'string') process.exit(0);

    // 分類は「実行される部分」に対して行い、記録は原文をそのまま残す
    const labels = classify(stripRedirectedHeredocs(command));
    const stamp = new Date().toLocaleString('ja-JP');
    const mark = labels.length > 0 ? `[!${labels.join(',')}]` : '[ ]';
    // 複数行コマンドは字下げして続け、1操作1ブロックで読めるようにする
    const body = command.split(/\r?\n/).join('\n      ');

    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${stamp} ${mark}\n      ${body}\n\n`, 'utf-8');
  } catch {
    // 記録に失敗しても作業は止めない
  }
  process.exit(0);
});
