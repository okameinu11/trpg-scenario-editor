// devenv共通: `devenv.config.json` の読み込み。
//
// 設定ファイルはリポジトリルートに置く。フック・スクリプトはどのcwdから
// 呼ばれても動くよう、親ディレクトリを遡って探す。
//
// 設定が見つからない場合はデフォルト（＝チェック無し・記録のみ）で動く。
// 「導入したがまだ設定していない」状態でコミットが止まらないようにするため。

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'devenv.config.json';

const DEFAULT_CONFIG = {
  project: { name: '', language: 'ja' },
  syncRules: [],
  guardedCommands: [],
  auditLog: {
    enabled: true,
    file: '.claude/logs/agent-actions.log',
    rotate: 'daily',
    extraLabels: [],
  },
  feedback: { basementPath: '', inboxDir: 'improvements/inbox' },
};

function findConfigFile(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadConfig(startDir = process.cwd()) {
  const file = findConfigFile(startDir);
  if (!file) {
    return {
      ...DEFAULT_CONFIG,
      configPath: null,
      configError: false,
      rootDir: path.resolve(startDir),
    };
  }

  let parsed;
  let configError = false;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    // 設定が壊れているのを黙って無視すると、チェックが効かないまま
    // 動き続けてしまう。ここだけは明示的に知らせる。
    console.error(`[devenv] ${CONFIG_FILE} の読み込みに失敗しました: ${error.message}`);
    parsed = {};
    // 設定を読めたかどうかは呼び出し側に伝える。読めなかったときに保護を
    // 縮退させる（guard-commands の BASELINE）判断がこれに乗っている。
    configError = true;
  }

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    auditLog: { ...DEFAULT_CONFIG.auditLog, ...(parsed.auditLog || {}) },
    feedback: { ...DEFAULT_CONFIG.feedback, ...(parsed.feedback || {}) },
    configPath: file,
    configError,
    rootDir: path.dirname(file),
  };
}

// 記録先のパスを決める。既定では日付ごとにファイルを分ける。
//
// ## なぜ分けるか
//
// 1ファイルに追記し続けると、オートモードでは実測で 200KB/日 近く増える。
// 半月で数MB・数万行に達し、「リスクのある操作が無かったか」を点検するのに
// 毎回その全体を相手にすることになる。点検は日付で範囲を切る作業なので、
// ファイル境界を日付に合わせておくと「前回の点検日より新しいファイルだけ見る」で済む。
//
// ## 日付をどの時計で決めるか
//
// 記録本文のタイムスタンプと同じローカル時刻で決める。ここだけUTCで決めると、
// 日本時間の朝9時までの記録が前日のファイルに入り、ファイル名と中身の日付が食い違う。
// タイムゾーンを設定で持たせないのは、本文と同じ時計を使う限り
// 食い違いが原理的に起きないためである。
//
//   .claude/logs/agent-actions.log
//     -> .claude/logs/2026-08/agent-actions-2026-08-31.log
//
// rotate: "daily"（既定） / "none"（従来どおり1ファイル）
function auditLogPath(config) {
  const audit = config.auditLog || {};
  const relative = audit.file || '.claude/logs/agent-actions.log';
  const rotate = audit.rotate || 'daily';
  const full = path.join(config.rootDir, relative);

  if (rotate !== 'daily') return full;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const ext = path.extname(full);
  const stem = path.basename(full, ext);

  return path.join(path.dirname(full), `${year}-${month}`, `${stem}-${year}-${month}-${day}${ext}`);
}

module.exports = { loadConfig, auditLogPath, CONFIG_FILE, DEFAULT_CONFIG };
