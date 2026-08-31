// PreToolUse hook (Bash): 実行してはいけないコマンドを、実行前に拒否する。
//
// ## なぜ必要か
//
// 「本番DBへ直接適用しない」「force pushしない」といった取り決めをCLAUDE.mdに
// 書いても、それは**お願い**でしかない。取り返しのつかない操作については、
// ドキュメントとは別に機械的な最終防衛線を置く。
//
// 遮断対象は devenv.config.json の `guardedCommands` で定義する:
//
//   "guardedCommands": [
//     {
//       "id": "supabase-db-push",
//       "pattern": "supabase\\s+db\\s+push",
//       "reason": "本番(リモート)DBへの直接適用コマンドです。…",
//       "requires": "…",   // 任意。これも満たすときだけ遮断する
//       "unless": "…"      // 任意。これに当てはまるときは遮断しない
//     }
//   ]
//
// ## 誤爆させないための工夫
//
// コミットメッセージ本文でコマンド名に言及しただけのケース
// （`git commit -m "$(cat <<'MSG' ... supabase db push ... MSG)"` など）を
// 実行と誤認すると、正当な作業が止まって信頼を失う。そこで
// **heredoc本文内・バッククォートで囲まれた出現は無視する**。
//
// それでも1本の pattern では書き分けられない例外はある（「秘密ファイルは止めたいが
// テンプレートのサンプルは通す」など）。そのための `requires` / `unless` で、
// 語彙は auditLog.extraLabels と同じにしてある。

const { loadConfig } = require('../../scripts/devenv/config');

const config = loadConfig();
const configured = Array.isArray(config.guardedCommands) ? config.guardedCommands : [];

// 設定が読めなかったときの最低限の遮断。
//
// ## なぜコード側に持つのか
//
// 遮断ルールを全て設定に置くと、**設定の可用性が保護の前提**になる。
// devenv.config.json にJSONの記述ミスがあるだけで guardedCommands は空になり、
// 何も遮断しないままコマンドが通る。知らせるのが stderr の1行だけだと
// 「止まらなかった＝安全なコマンドだった」と誤読させる。
// JSONに正規表現を書く以上、記述ミスは現実に起きる。
//
// ここに置くのは**プロジェクトに依存せず、実行したら戻せないもの**だけに絞る。
// 設定を持つプロジェクトはこちらを使わないので、常用の遮断は設定側に書く
// （設定を持てば上書きできる＝逃げ道が残る、という関係を壊さないため）。
const BASELINE = [
  {
    id: 'git-force-push',
    pattern: String.raw`git\s+push\s+(?:[^|;&]*\s)?(?:--force(?!-with-lease)|-f)\b`,
    reason:
      '共有ブランチの履歴を壊す可能性があります。どうしても必要なら --force-with-lease を使い、ユーザーに確認してから実行してください。',
  },
  {
    id: 'rm-rf-root',
    pattern: String.raw`\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:/|~|\$HOME)(?:\s|;|&|\||$)`,
    reason:
      'ファイルシステムのルートまたはホームディレクトリを再帰削除しようとしています。対象パスを具体的に指定し直してください。',
  },
];

const degraded = !config.configPath || config.configError === true;
const guarded = configured.length > 0 ? configured : BASELINE;

if (degraded) {
  console.error(
    '[devenv] devenv.config.json を読めなかったため、最低限の遮断のみで動作しています' +
      '（guard-commands の BASELINE）。設定を直してください。'
  );
}

/** heredoc（<<TAG … TAG）の本文範囲を求める。 */
function findHeredocRanges(command) {
  const ranges = [];
  const markerPattern = /<<-?\s*(['"]?)(\w+)\1/g;
  let match;
  while ((match = markerPattern.exec(command))) {
    const tag = match[2];
    const bodyStart = markerPattern.lastIndex;
    const closing = new RegExp(String.raw`\n[ \t]*${tag}\b`).exec(command.slice(bodyStart));
    const bodyEnd = closing ? bodyStart + closing.index : command.length;
    ranges.push([bodyStart, bodyEnd]);
  }
  return ranges;
}

function isInsideRange(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function isBacktickQuoted(command, index, length) {
  return command.slice(0, index).endsWith('`') && command.slice(index + length).startsWith('`');
}

/** 「文字列としての言及」ではなく「実際の実行」に見える出現があるか。 */
function hasRealInvocation(command, pattern) {
  const heredocRanges = findHeredocRanges(command);
  const regexp = new RegExp(pattern, 'gi');
  let match;
  while ((match = regexp.exec(command))) {
    if (isInsideRange(match.index, heredocRanges)) continue;
    if (isBacktickQuoted(command, match.index, match[0].length)) continue;
    return true;
  }
  return false;
}

/** requires / unless はコマンド全体に対して判定する（例外は文脈で決まるため）。 */
function conditionsSatisfied(command, rule) {
  if (rule.requires && !new RegExp(rule.requires, 'i').test(command)) return false;
  if (rule.unless && new RegExp(rule.unless, 'i').test(command)) return false;
  return true;
}

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  if (guarded.length === 0) process.exit(0);

  let command;
  try {
    command = JSON.parse(input)?.tool_input?.command;
  } catch {
    process.exit(0);
  }
  if (typeof command !== 'string') process.exit(0);

  for (const rule of guarded) {
    if (!rule || !rule.pattern) continue;
    let hit = false;
    try {
      hit = hasRealInvocation(command, rule.pattern) && conditionsSatisfied(command, rule);
    } catch {
      continue;
    }
    if (!hit) continue;

    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `[${rule.id || 'guarded-command'}] このコマンドはプロジェクトの方針により実行を禁止しています。\n` +
            `${rule.reason || 'devenv.config.json の guardedCommands を参照してください。'}`,
        },
      })
    );
    process.exit(0);
  }

  process.exit(0);
});
