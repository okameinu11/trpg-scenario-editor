// PreToolUse hook (Write|Edit|NotebookEdit): ファイルの作成・編集を記録する。
//
// 変更内容そのものは git で追えるが、
//   - まだコミットしていない編集
//   - コミット前に上書きされて消えた中間状態
// は git に残らない。「いつ・どのファイルを触ったか」の時系列だけでも残しておくと、
// あとから経緯を追える。
//
// 何もブロックしない（常に exit 0）。差分は記録しない（肥大化するため。
// 内容の確認は git diff / git show を使う）。
//
// 記録先は audit-log.js と同じファイル（既定では日付ごとに分かれる）。

const fs = require('fs');
const path = require('path');
const { loadConfig, auditLogPath } = require('../../scripts/devenv/config');

const config = loadConfig();
const auditConfig = config.auditLog || {};

if (auditConfig.enabled === false) process.exit(0);

const LOG_FILE = auditLogPath(config);

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const tool = payload?.tool_name;
    const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
    if (typeof target !== 'string') process.exit(0);

    // 新規作成か上書きかは、この時点でのファイルの有無で判定する
    const exists = fs.existsSync(target);
    const kind = tool === 'Write' ? (exists ? 'WRITE(上書き)' : 'WRITE(新規)') : tool;

    const stamp = new Date().toLocaleString('ja-JP');
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${stamp} [FILE:${kind}] ${target}\n\n`, 'utf-8');
  } catch {
    // 記録に失敗しても作業は止めない
  }
  process.exit(0);
});
