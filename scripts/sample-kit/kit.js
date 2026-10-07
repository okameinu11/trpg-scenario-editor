/*
 * サンプルシナリオの道具（ブラウザ側）
 *
 * run.js が index.html を開いたページに読み込ませて使う。アプリの関数と変数
 * （API・selectScenario・updatePreview・previewArea・GAME_SYSTEMS・ACTIONS など）をそのまま呼ぶので、
 * 必ずアプリと同じページで動かすこと。単体では動かない。
 *
 * 原本は samples/<slug>/body.md と data.json（形式は同じフォルダの source-format.md）。
 * 書き出すJSONは毎回ここから作り直す。画像は種（meta.seed）を固定して描くので、作り直しても同じ絵になる。
 *
 * アプリの記法や項目が増えたら、下の FEATURES と features.md に1行ずつ足すこと。足さないと、verify の drift に
 * 「どの機能にも対応しない操作」として出続ける（それが追従のきっかけになる）。
 */
window.SampleKit = (function () {
  'use strict';

  const SERIF = '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  // このキットが扱い方を知っているシステム。増えたら systems.md にも節を足す
  const KNOWN_SYSTEMS = ['emoklore', 'coc6'];

  // ---------------------------------------------------------------
  // 機能の一覧（網羅の確認と、アプリに増えた機能の検出に使う）
  //
  // actions: 対応する ACTIONS の id。ACTIONS に増えた操作がどの機能にも対応しないと drift に出る
  // systems: 使えるシステム（省略は全システム）
  // count(c): 使われている数。c = { q(selector), body, d（アプリに取り込んだあとのデータ） }
  // ---------------------------------------------------------------
  const FEATURES = [
    // 本文の骨組み
    { id: 'scene', area: '本文', label: 'シーン見出し（#）', actions: ['scene'], count: c => c.q('h2.scene-title') },
    { id: 'subtitle', area: '本文', label: '探索小見出し（##）', actions: ['search-title'], count: c => c.q('h3.search-subtitle') },
    { id: 'search', area: '本文', label: '探索一覧', actions: ['search-list'], count: c => c.q('.search-box') },
    { id: 'map-all', area: '本文', label: '場面図（全体）', actions: ['scene-map-insert'], count: c => (c.body.match(/^\[場面図\]$/gm) || []).length },
    { id: 'map-part', area: '本文', label: '場面図（場面名を指定）', actions: ['scene-map-insert'], count: c => (c.body.match(/^\[場面図\s*[:：][^\]\n]+\]$/gm) || []).length },
    { id: 'toc', area: '本文', label: '目次', actions: ['toc-insert'], count: c => c.q('.scenario-toc') },
    // 本文の文章
    { id: 'read', area: '本文', label: '情景描写（>）', actions: ['read'], count: c => c.q('.read-text') },
    { id: 'speech', area: '本文', label: 'NPCのセリフ', actions: ['npc-speech'], count: c => c.q('.npc-speech') },
    { id: 'speech-note', area: '本文', label: 'セリフの備考', actions: ['npc-speech'], count: c => c.q('.npc-speech-note') },
    { id: 'info', area: '本文', label: '情報（プレイヤーへ渡す）', actions: ['info', 'info-list'], count: c => c.q('.info-block:not(.info-missing)') },
    { id: 'info-limited', area: '本文', label: '公開対象を絞った情報', actions: ['info'], count: c => c.q('.info-block .info-target-some') },
    { id: 'gm', area: '本文', label: 'GM向け情報（[DL] / [KP]）', actions: ['dl'], count: c => c.q('.dl-info') },
    { id: 'tips', area: '本文', label: 'TIPS', actions: ['tips'], count: c => c.q('.side-note') },
    { id: 'side-stack', area: '本文', label: '右の段に積む（空行のあとに >> だけの段落）', actions: [], count: c => splitBlocks(c.body).filter(b => b.text.startsWith('>>')).length },
    { id: 'side-text', area: '本文', label: '右の段の地の文（>> 文）', actions: [], count: c => c.q('.side-content > p') },
    { id: 'color-preset', area: '本文', label: '文字色（固定の色）', actions: ['color'], count: c => c.q('[class^="ic-"]') },
    { id: 'color-custom', area: '本文', label: '文字色（#16進の任意の色）', actions: ['color'], count: c => c.q('span[style*="color: #"]') },
    // 判定
    { id: 'roll', area: '本文', label: '技能判定', actions: ['roll'], count: c => c.q('.roll-box:not(.san-box)') },
    { id: 'roll-multiline', area: '本文', label: '判定の結果を複数行で書く', actions: ['roll'], count: c => Array.from(previewArea.querySelectorAll('.result-text')).filter(e => e.querySelector('br')).length },
    { id: 'resonance', area: '本文', label: '共鳴判定', actions: ['resonance'], systems: ['emoklore'], count: c => c.q('.resonance-box') },
    { id: 'san', area: '本文', label: 'SANチェック', actions: ['san'], systems: ['coc6'], count: c => c.q('.san-box') },
    // NPC
    { id: 'npc-card', area: 'NPC', label: 'NPCカード（大）', actions: ['npc'], count: c => c.q('.main-content > .npc-card:not(.mini)') },
    { id: 'npc-mini', area: 'NPC', label: 'NPCカード（小・右の段）', actions: ['npc'], count: c => c.q('.side-content .npc-card.mini') },
    { id: 'npc-avatar', area: 'NPC', label: 'NPCの立ち絵', actions: ['npc'], count: c => c.d.npcs.filter(n => n.avatarUrl).length },
    { id: 'npc-color', area: 'NPC', label: 'セリフの色', actions: ['npc'], count: c => c.d.npcs.filter(n => n.color).length },
    { id: 'npc-memos', area: 'NPC', label: 'NPCのメモを複数持つ', actions: ['npc'], count: c => c.d.npcs.filter(n => (n.memos || []).length >= 2).length },
    { id: 'npc-skills', area: 'NPC', label: 'NPCの技能', actions: ['npc'], count: c => c.d.npcs.filter(n => (n.status.skills || []).length).length },
    { id: 'npc-emotions', area: 'NPC', label: 'NPCの共鳴感情', actions: ['npc'], systems: ['emoklore'], count: c => c.d.npcs.filter(n => (n.status.emotions || []).length).length },
    // 場面ツリー（執筆／場面図の切り替え scene-map で開く画面のデータ）
    { id: 'scene-card', area: '場面', label: '場面カード', actions: ['scene-map'], count: c => c.d.scenes.nodes.length },
    { id: 'scene-edge-label', area: '場面', label: '分岐の条件（接続のラベル）', actions: ['scene-map'], count: c => c.d.scenes.edges.filter(e => e.label).length },
    { id: 'scene-hidden', area: '場面', label: '図解に出さない場面', actions: ['scene-map'], count: c => c.d.scenes.nodes.filter(n => n.inDiagram === false).length },
    { id: 'scene-npc', area: '場面', label: '場面カードに登場するNPC', actions: ['scene-map'], count: c => c.d.scenes.nodes.filter(n => n.npcIds.length).length },
    // 基本情報（表紙）
    { id: 'cover-thumb', area: '基本情報', label: 'サムネイル', actions: ['basic-info'], count: c => c.q('.cover-thumb img') },
    { id: 'cover-section', area: '基本情報', label: '見出しと本文', actions: ['basic-info'], count: c => c.q('.cover-section') },
    { id: 'cover-subheading', area: '基本情報', label: '小見出し（プレイ人数など）', actions: ['basic-info'], count: c => countBasicBlocks(c.d.basicInfo, 'subheading') },
    { id: 'cover-level', area: '基本情報', label: 'レベル表示', actions: ['basic-info'], count: c => c.q('.level-symbols') },
    { id: 'cover-level-solo', area: '基本情報', label: '見出しに属さないレベル', actions: ['basic-info'], count: c => c.d.basicInfo.items.filter(x => x.kind === 'level').length },
    // 巻末
    { id: 'faq', area: '巻末', label: 'FAQ', actions: ['faq'], count: c => c.q('.faq-item') },
    { id: 'backmatter', area: '巻末', label: 'あとがきなどの節', actions: ['afterword'], count: c => c.q('.backmatter-section') },
    { id: 'rights', area: '巻末', label: '権利表記', actions: ['afterword'], count: c => c.q('.scenario-rights') }
  ];

  // シナリオのデータに残らない操作（サンプルで見せようがないもの）。ここに無く FEATURES にも無い操作は drift に出る
  const APP_ONLY_ACTIONS = ['palette', 'undo', 'redo', 'cloud-save', 'list', 'pdf', 'shortcut-settings'];

  // 記法の一覧（docs/01_要件定義書.html §4.1 の表）の行と、FEATURES の対応。
  // ボタン（ACTIONS）の無い書き方は unknownActions では見つからないので、表の行でも突き合わせる。
  // 表に行が増えてここに無いと drift.docRows.unmapped に出る。行名は日付の注記（（2026-10-05 追加）など）を除いたもの
  const DOC_ROWS = {
    'シーン見出し': ['scene'], '探索小見出し': ['subtitle'], '通常文章': [],
    '情景描写・セリフ': ['read'], 'NPCのセリフ': ['speech', 'speech-note'], 'プレイヤーへ渡す情報': ['info', 'info-limited'],
    'GM向け情報（DL情報／KP情報）': ['gm'], '探索可能箇所一覧': ['search'], '共鳴判定': ['resonance'], 'SANチェック': ['san'],
    '文字色（インライン）': ['color-preset', 'color-custom'], 'TIPS・補足（右）': ['tips', 'side-stack'], '通常文章（右）': ['side-text'],
    '小さなNPCカード（右）': ['npc-mini'], '場面図': ['map-all', 'map-part'], '目次': ['toc']
  };
  const DOC_TABLE = { url: '/docs/01_要件定義書.html', heading: '4.1' };

  // プレビューに変換されずに残った記法
  const LEFTOVER_RE = /\[(?:判定|共鳴|SAN|探索|調査|情報|セリフ|NPC|場面図|目次|DL|KP|TIPS)[^\]\n]*\]|\{[^{}:：\n]{1,16}[:：][^{}\n]*\}/g;
  // 段落の先頭でしか効かない記法（2行目以降に書くと変換されない）
  const BLOCK_START_RE = /^(?:#|\[(?:判定|SAN|共鳴|探索|調査|情報|セリフ|NPC|場面図)\s*[:：\]]|\[(?:DL|KP|目次)\])/i;
  const ROLL_TYPES = ['強制', '提示推奨', '非提示推奨'];

  // ---------------------------------------------------------------
  // 小道具
  // ---------------------------------------------------------------
  const arr = v => Array.isArray(v) ? v : [];
  const str = v => typeof v === 'string' ? v : '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s).replace(/\r\n/g, '\n');
  const uniq = a => Array.from(new Set(a));

  function countBasicBlocks(bi, kind) {
    return arr(bi && bi.items).reduce((n, x) => n + (x.kind === 'section' ? arr(x.blocks).filter(b => b.kind === kind).length : 0), 0);
  }

  // 版の比較（"1.12.1" 形式）。a が新しければ正
  function cmpVer(a, b) {
    const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // 段落に分ける。アプリの parseMarkdown() と同じく「\n が2つ以上」で切り、各段落の開始行を持つ
  function splitBlocks(text) {
    const out = [];
    const sep = /\n{2,}/g;
    let start = 0, m;
    const push = (s, e) => {
      const raw = text.slice(s, e);
      const lead = raw.length - raw.replace(/^\s+/, '').length;
      const body = raw.trim();
      if (body) out.push({ text: body, line: text.slice(0, s + lead).split('\n').length });
    };
    while ((m = sep.exec(text)) !== null) { push(start, m.index); start = sep.lastIndex; }
    push(start, text.length);
    return out;
  }

  // 線形合同法。初版のサンプルと同じ式で、同じ種なら同じ並びになる
  function makeRand(seed) {
    let s = Number(seed) || 1;
    return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  }
  function hashSeed(text) {
    let h = 2166136261;
    for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h || 1;
  }

  async function fetchText(url) {
    const res = await fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now());
    if (!res.ok) return null;
    return res.text();
  }

  // ---------------------------------------------------------------
  // 原本の読み込み
  // ---------------------------------------------------------------
  async function load(slug) {
    const base = '/samples/' + encodeURIComponent(slug) + '/';
    const body = await fetchText(base + 'body.md');
    if (body === null) throw new Error('samples/' + slug + '/body.md が見つかりません');
    const dataText = await fetchText(base + 'data.json');
    if (dataText === null) throw new Error('samples/' + slug + '/data.json が見つかりません');
    let data;
    try { data = JSON.parse(dataText); } catch (e) { throw new Error('data.json が JSON として読めません: ' + e.message); }
    const thumbCode = await fetchText(base + 'thumb.js');
    let thumb = null, thumbError = '';
    if (thumbCode !== null) {
      try { thumb = (0, eval)('(' + thumbCode + '\n)'); } catch (e) { thumbError = e.message; }
      if (!thumbError && typeof thumb !== 'function') thumbError = 'thumb.js は (g, W, H, rand, d, util) => { … } の形の関数1つにしてください';
    }
    return { body: norm(body), data: data, thumb: thumb, thumbError: thumbError };
  }

  // ---------------------------------------------------------------
  // 静的な検査（組み立て前に分かる誤り）
  // ---------------------------------------------------------------
  function lint(src) {
    const body = src.body, d = src.data;
    const errors = [], warnings = [];
    const E = (at, msg) => errors.push((at ? at + '：' : '') + msg);
    const W = (at, msg) => warnings.push((at ? at + '：' : '') + msg);

    ['id', 'title', 'system'].forEach(k => { if (!d[k]) E('data.json', k + ' がありません'); });
    const sys = GAME_SYSTEMS[d.system];
    if (d.system && !sys) E('data.json', 'system「' + d.system + '」はアプリにありません（' + Object.keys(GAME_SYSTEMS).join(' / ') + '）');
    if (src.thumbError) E('thumb.js', src.thumbError);
    if (!(d.meta && d.meta.premise)) W('data.json', 'meta.premise（舞台・怪異・結末の型の要約）がありません。次のサンプルを書くとき、重なりを確かめるのに使う');

    const npcs = arr(d.npcs), infos = arr(d.infos);
    const nodes = arr(d.scenes && d.scenes.nodes), edges = arr(d.scenes && d.scenes.edges);
    const npcNames = npcs.map(n => str(n.name).trim());
    const npcIds = npcs.map(n => n.id);
    const infoTitles = infos.map(x => str(x.title).trim());
    const nodeTitles = nodes.map(n => str(n.title).trim());

    // 名前・題名の重複（本文からは名前で引くので、重なるとどちらを指すか決まらない）
    const dups = (list, what) => uniq(list.filter((v, i) => v && list.indexOf(v) !== i)).forEach(v => E('data.json', what + '「' + v + '」が重複しています'));
    dups(npcNames, 'NPCの名前'); dups(npcIds, 'NPCの id'); dups(infoTitles, '情報の題名');
    dups(nodeTitles, '場面カードの題名'); dups(nodes.map(n => n.id), '場面カードの id');

    // スキル名の照合用（警告のみ。能力値や派生値での判定もあるため）
    const skillNames = [], extraNames = [];
    if (sys) {
      Object.values(sys.skills || {}).forEach(list => list.forEach(raw => skillNames.push(Array.isArray(raw) ? raw[0] : raw)));
      arr(sys.abilities).forEach(a => extraNames.push(a.label, a.key.toUpperCase()));
      arr(sys.derived).forEach(a => extraNames.push(a.label));
    }
    const allow = arr(d.meta && d.meta.allowSkills);
    const knownSkill = name => {
      const n = name.replace(/[×xX*]\s*\d+$/, '').trim();
      if (!n || allow.indexOf(n) !== -1) return true;
      if (skillNames.some(s => s === n || s.replace(/（任意）$/, '') === n || (s.endsWith('（任意）') && n.startsWith(s.replace(/（任意）$/, '') + '（')))) return true;
      return extraNames.some(l => l && (l === n || l.indexOf(n) !== -1));
    };
    const badgeKnown = key => !sys || arr(sys.badges).some(b => b.match.indexOf(key) !== -1);

    // 行ごとの検査
    body.split('\n').forEach((ln, i) => {
      const at = '本文 ' + (i + 1) + '行目';
      if (/^###/.test(ln)) E(at, '「###」は使えません。見出しは # と ## の2段だけで、### は「#」の残った小見出しになります');
      if (/^[ \t　]+$/.test(ln)) W(at, '空白だけの行は空行になりません（前後の段落がつながる）。空白を消してください');
      const open = ln.match(/\{(?:赤|青|緑|橙|紫|灰|#[0-9a-fA-F]{3,6})[:：][^{}]*$/);
      if (open) W(at, '文字色の閉じ括弧「}」が同じ行にありません。文字色は1行の中で閉じます');
      (ln.match(/\{([^{}:：\n]{1,16})[:：][^{}\n]*\}/g) || []).forEach(m => {
        const key = m.slice(1).split(/[:：]/)[0].trim();
        if (!INLINE_COLORS[key] && !HEX_COLOR_RE.test(key)) W(at, '「' + m.slice(0, 20) + '」は文字色になりません（色名は ' + Object.keys(INLINE_COLORS).join(' ') + '、または #rrggbb）');
      });
    });

    const headings1 = [], refInfos = new Set(), refNpcs = new Set();
    splitBlocks(body).forEach(b => {
      const at = '本文 ' + b.line + '行目';
      const t = b.text;
      if (t.startsWith('#')) {
        if (t.indexOf('\n') !== -1) E(at, '見出しのすぐ下の行まで見出しに含まれます。見出しの後ろに空行を入れてください');
        if (!t.startsWith('##')) headings1.push(t.split('\n')[0].replace(/^#\s*/, '').trim());
        return;
      }
      if (/^\[目次\]/.test(t) && t !== '[目次]') E(at, '[目次] は前後に空行を入れ、その行だけの段落にします');
      if (t.startsWith('[場面図')) {
        const m = t.match(/^\[場面図(?:\s*[:：]\s*([^\]\n]+))?\]$/);
        if (!m) E(at, '場面図は前後に空行を入れ、その行だけの段落にします');
        else if (m[1] && nodeTitles.indexOf(m[1].trim()) === -1) E(at, '場面図の場面「' + m[1].trim() + '」は場面カードにありません');
        return;
      }
      if (t === '[目次]') return;

      const sides = (t.match(/>>/g) || []).length;
      if (sides > 1) E(at, '1つの段落に >> は1つだけです。2つ目からは記号のまま右の段に出ます。段落を分けてください');
      const split = t.indexOf('>>');
      const main = split === -1 ? t : t.slice(0, split).trim();
      const side = split === -1 ? '' : t.slice(split + 2).trim();
      const lines = main.split('\n');
      const first = lines[0] || '';

      lines.slice(1).forEach((ln, k) => {
        const lat = '本文 ' + (b.line + k + 1) + '行目';
        if (BLOCK_START_RE.test(ln.trim())) E(lat, '段落の途中に書いた記法は変換されません。前に空行を入れて段落を分けてください');
        if (first.startsWith('>') && /^>(?!>)/.test(ln.trim())) E(lat, '情景描写の > は段落の先頭に1つだけ書きます。2行目以降の > は記号のまま出ます');
      });

      if (/^\[(?:判定:|SAN\s*[:：])/i.test(first)) {
        lines.slice(1).forEach((ln, k) => {
          const s = ln.trim();
          if (!s.startsWith('-')) return;
          const lat = '本文 ' + (b.line + k + 1) + '行目';
          const colon = s.indexOf(':');
          if (colon === -1) { E(lat, '結果の行は半角の「:」で区切ります（全角の「：」や区切りの無い行は、プレビューから黙って消えます）'); return; }
          const key = s.slice(1, colon).trim();
          if (!badgeKnown(key)) W(lat, '成功段階「' + key + '」はこのシステムにありません。失敗と同じ色で出ます（判定の自由枠は端末ごとの設定なので、サンプルでは使わない）');
        });
      }
      const roll = first.match(/^\[判定:\s*([^\]]+)\]/);
      if (roll) {
        const parts = roll[1].split('/');
        parts[0].split(/\s*(?:または|、|・|，|,)\s*/).forEach(nm => { if (!knownSkill(nm.trim())) W(at, '判定の技能「' + nm.trim() + '」は ' + (sys ? sys.short : '') + ' の技能一覧にありません（意図したものなら data.json の meta.allowSkills に足す）'); });
        if (parts[1] && ROLL_TYPES.indexOf(parts[1].trim()) === -1) W(at, '提示タイプ「' + parts[1].trim() + '」は色の付かないバッジになります（' + ROLL_TYPES.join(' / ') + '）');
      }
      if (sys && /^\[共鳴:/.test(first) && !sys.hasResonanceRoll) W(at, '共鳴判定は ' + sys.short + ' にはありません');
      if (sys && /^\[SAN\s*[:：]/i.test(first) && !sys.hasSanCheck) W(at, 'SANチェックは ' + sys.short + ' にはありません');
      const gm = first.match(/^\[(DL|KP)\]/);
      if (sys && gm && gm[1] !== sys.gmInfoTag) W(at, sys.short + ' のGM向け情報は [' + sys.gmInfoTag + '] です（[' + gm[1] + '] も表示はされる）');

      const info = first.match(/^\[情報[:：]\s*([^\]\n]+)\]/);
      if (info) {
        const title = info[1].trim();
        refInfos.add(title);
        if (infoTitles.indexOf(title) === -1) E(at, '情報「' + title + '」が data.json の infos にありません');
      }
      const speech = first.match(/^\[セリフ[:：]\s*([^\]]+)\]/);
      if (speech) {
        const name = speech[1].split(/[/／]/)[0].trim();
        refNpcs.add(name);
        if (npcNames.indexOf(name) === -1) E(at, 'セリフのNPC「' + name + '」が data.json の npcs にありません');
      }
      [first, side].forEach(part => {
        const card = part.match(/^\[NPC:\s*([^\]/]+)(?:\/簡易)?\]/);
        if (!card) return;
        const name = card[1].trim();
        refNpcs.add(name);
        if (npcNames.indexOf(name) === -1) E(at, 'NPCカード「' + name + '」が data.json の npcs にありません');
      });
    });

    // 場面カードと本文の見出し（題名の完全一致でつながる）
    nodes.forEach(n => {
      const t = str(n.title).trim();
      if (!t) W('場面カード ' + n.id, '題名が空です');
      else if (headings1.indexOf(t) === -1) E('場面カード「' + t + '」', '同じ題名の # 見出しが本文にありません（完全一致でつながる）');
      if (n.kind && !SCENE_KINDS[n.kind]) E('場面カード「' + t + '」', 'kind「' + n.kind + '」はありません（' + Object.keys(SCENE_KINDS).join(' / ') + '）。黙って「その他」になります');
      arr(n.npcIds).forEach(id => { if (npcIds.indexOf(id) === -1) E('場面カード「' + t + '」', 'npcIds の「' + id + '」が npcs にありません'); });
    });
    headings1.forEach(h => { if (nodeTitles.indexOf(h) === -1) W('見出し「' + h + '」', '対応する場面カードがありません（場面図に出ない）'); });

    // 接続（壊れた接続はアプリが黙って捨てる）
    const nodeIdSet = new Set(nodes.map(n => n.id));
    const pairs = new Set();
    edges.forEach(e => {
      const at = '接続 ' + e.from + '→' + e.to;
      if (!nodeIdSet.has(e.from) || !nodeIdSet.has(e.to)) E(at, '端の場面カードがありません（黙って捨てられる）');
      if (e.from === e.to) E(at, '自分自身への接続は捨てられます');
      if (pairs.has(e.from + '>' + e.to)) W(at, '同じ接続が2本あります');
      pairs.add(e.from + '>' + e.to);
    });
    const outs = new Map();
    edges.forEach(e => { if (!outs.has(e.from)) outs.set(e.from, []); outs.get(e.from).push(e.to); });
    const state = new Map();
    const visit = (id, path) => {
      if (state.get(id) === 1) { E('接続', '輪になっています（' + path.concat(id).join(' → ') + '）。場面ツリーは輪を作れず、一部が捨てられます'); return; }
      if (state.get(id) === 2) return;
      state.set(id, 1);
      (outs.get(id) || []).forEach(to => visit(to, path.concat(id)));
      state.set(id, 2);
    };
    nodes.forEach(n => visit(n.id, []));

    // NPC
    npcs.forEach(n => {
      const at = 'NPC「' + str(n.name) + '」';
      if (n.color && !/^#[0-9a-fA-F]{6}$/.test(n.color)) E(at, 'color は #rrggbb で書きます（それ以外は黙って捨てられる）');
      if (!n.avatar && !n.avatarUrl) W(at, '立ち絵がありません（avatar を指定すると自動で描く）');
      if (n.avatar && !n.avatar.initial) E(at, 'avatar.initial（立ち絵に描く1文字）がありません');
      const st = n.status || {};
      arr(st.skills).forEach(s => { const nm = String(s).split(/[:：]/)[0].trim(); if (!knownSkill(nm)) W(at, '技能「' + nm + '」は技能一覧にありません'); });
      if (sys && !sys.hasEmotions && arr(st.emotions).length) W(at, sys.short + ' に共鳴感情はありません');
      const appears = refNpcs.has(str(n.name).trim()) || nodes.some(x => arr(x.npcIds).indexOf(n.id) !== -1);
      if (!appears) W(at, '本文にも場面カードにも出てきません');
    });

    // 情報
    infos.forEach(x => {
      const at = '情報「' + str(x.title) + '」';
      if (!str(x.target).trim()) W(at, '公開対象が空です（「公開対象 未設定」と出る）');
      if (!refInfos.has(str(x.title).trim())) W(at, '本文から参照されていません');
    });

    // 基本情報
    const levelCheck = (lv, at) => {
      const max = Number(lv.max == null ? 5 : lv.max), value = Number(lv.value);
      if (!(max >= 1 && max <= LEVEL_MAX_LIMIT)) E(at, 'max は 1〜' + LEVEL_MAX_LIMIT + ' です');
      if (!(value >= 0 && value <= max)) E(at, 'value は 0〜max です');
      if (lv.symbol && !LEVEL_SYMBOL_BY_ID[lv.symbol]) E(at, '記号「' + lv.symbol + '」はありません（' + LEVEL_SYMBOLS.map(s => s.id).join(' / ') + '）');
    };
    arr(d.basicInfo && d.basicInfo.items).forEach((x, i) => {
      const at = '基本情報 ' + (i + 1) + '番目';
      if (x.kind === 'level') levelCheck(x, at + '（レベル「' + str(x.label) + '」）');
      else if (x.kind === 'section') arr(x.blocks).forEach(bk => { if (bk.kind === 'level') levelCheck(bk, at + '「' + str(x.heading) + '」のレベル「' + str(bk.label) + '」'); });
      else E(at, 'kind は section か level です');
    });
    if (!d.thumbnail && !(d.basicInfo && d.basicInfo.thumbnailUrl) && !src.thumb) W('基本情報', 'サムネイルの指定（thumbnail か thumb.js）がありません');

    // 巻末
    arr(d.faqs).forEach((f, i) => { if (!str(f.question).trim() || !str(f.answer).trim()) W('FAQ ' + (i + 1) + '番目', '質問か回答が空です'); });
    if (!str(d.backMatter && d.backMatter.rights).trim()) W('巻末', '権利表記が空です');

    // 長さ
    const chars = body.replace(/\s/g, '').length;
    const target = Number(d.meta && d.meta.targetLength) || 0;
    if (target && chars < target * 0.9) W('本文', '長さが ' + chars + '字で、目標（' + target + '字）の9割に届いていません');

    return {
      errors: errors, warnings: warnings,
      stats: { chars: chars, scenes: headings1.length, npcs: npcs.length, infos: infos.length, sceneCards: nodes.length, edges: edges.length, faqs: arr(d.faqs).length }
    };
  }

  // ---------------------------------------------------------------
  // 画像（立ち絵とサムネイル）
  // ---------------------------------------------------------------
  function toImage(c) {
    const url = c.toDataURL('image/webp', 0.86);
    return url.indexOf('data:image/webp') === 0 ? url : c.toDataURL('image/jpeg', 0.86);
  }

  // 立ち絵：色のグラデーション＋模様＋頭文字。bubbles と waves は初版のサンプルと同じ描き方
  function drawAvatar(a, pattern, rand) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, a.from || '#334155'); grad.addColorStop(1, a.to || '#94a3b8');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    if (pattern === 'bubbles') {
      g.globalAlpha = 0.18; g.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(rand() * 512, rand() * 512, 40 + rand() * 120, 0, Math.PI * 2); g.fill(); }
    } else if (pattern === 'waves') {
      g.globalAlpha = 0.16; g.strokeStyle = '#ffffff'; g.lineWidth = 10;
      for (let i = 0; i < 5; i++) { g.beginPath(); const y = 80 + i * 90; g.moveTo(0, y); for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 40 + i) * 14); g.stroke(); }
    } else if (pattern === 'rings') {
      g.globalAlpha = 0.14; g.strokeStyle = '#ffffff'; g.lineWidth = 12;
      for (let r = 60; r < 420; r += 70) { g.beginPath(); g.arc(256, 276, r, 0, Math.PI * 2); g.stroke(); }
    } else if (pattern === 'grid') {
      g.globalAlpha = 0.12; g.strokeStyle = '#ffffff'; g.lineWidth = 4;
      for (let p = 32; p < 512; p += 64) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.font = 'bold 280px ' + SERIF; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(a.initial || '?', 256, 276);
    return toImage(c);
  }

  // thumb.js が無いときのサムネイル：色の帯＋模様（motif）＋題名
  function drawGenericThumb(g, W, H, rand, d) {
    const t = d.thumbnail || {};
    const cols = arr(t.colors).length >= 2 ? t.colors : ['#0f172a', '#1e293b', '#334155'];
    const grad = g.createLinearGradient(0, 0, W, H);
    cols.forEach((col, i) => grad.addColorStop(i / (cols.length - 1), col));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const accent = t.accent || 'rgba(226, 232, 240, 1)';
    g.save();
    if (t.motif === 'rain') {
      g.strokeStyle = 'rgba(191, 219, 254, 0.35)'; g.lineWidth = 2;
      for (let i = 0; i < 260; i++) { const x = rand() * W, y = rand() * H, l = 30 + rand() * 50; g.beginPath(); g.moveTo(x, y); g.lineTo(x - l * 0.25, y + l); g.stroke(); }
    } else if (t.motif === 'snow') {
      g.fillStyle = 'rgba(255, 255, 255, 0.7)';
      for (let i = 0; i < 220; i++) { g.beginPath(); g.arc(rand() * W, rand() * H, 1 + rand() * 4, 0, Math.PI * 2); g.fill(); }
    } else if (t.motif === 'stars') {
      g.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (let i = 0; i < 180; i++) { g.globalAlpha = 0.3 + rand() * 0.7; g.fillRect(rand() * W, rand() * H * 0.7, 2, 2); }
    } else if (t.motif === 'fog') {
      for (let i = 0; i < 9; i++) {
        const y = H * 0.35 + rand() * H * 0.6, h = 60 + rand() * 90;
        const fog = g.createLinearGradient(0, y, 0, y + h);
        fog.addColorStop(0, 'rgba(226, 232, 240, 0)'); fog.addColorStop(0.5, 'rgba(226, 232, 240, 0.12)'); fog.addColorStop(1, 'rgba(226, 232, 240, 0)');
        g.fillStyle = fog; g.fillRect(0, y, W, h);
      }
    } else if (t.motif === 'embers') {
      for (let i = 0; i < 40; i++) {
        const x = rand() * W, y = H * 0.4 + rand() * H * 0.6, r = 10 + rand() * 40;
        const lg = g.createRadialGradient(x, y, 0, x, y, r);
        lg.addColorStop(0, 'rgba(251, 146, 60, 0.5)'); lg.addColorStop(1, 'rgba(251, 146, 60, 0)');
        g.fillStyle = lg; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    g.restore();
    // 題名が長いときは、幅に収まるまで文字を小さくする
    const fit = (text, size, min) => { let s = size; do { g.font = 'bold ' + s + 'px ' + SERIF; s -= 4; } while (g.measureText(text).width > W - 220 && s > min); };
    g.fillStyle = '#f8fafc'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    fit(str(t.title || d.title), 116, 56); g.fillText(str(t.title || d.title), 110, 320);
    if (t.subtitle) { g.fillStyle = accent; g.globalAlpha = 0.85; g.font = '44px ' + SERIF; g.fillText(t.subtitle, 116, 400); g.globalAlpha = 1; }
  }

  function drawThumb(src, rand) {
    const d = src.data;
    if (d.basicInfo && /^data:image\//.test(str(d.basicInfo.thumbnailUrl))) return d.basicInfo.thumbnailUrl;
    if (!src.thumb && !d.thumbnail) return '';
    const W = 1600, H = 900;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (src.thumb) src.thumb(g, W, H, rand, d, { serif: SERIF });
    else drawGenericThumb(g, W, H, rand, d);
    return toImage(c);
  }

  // ---------------------------------------------------------------
  // 組み立て・取り込み・開く
  // ---------------------------------------------------------------
  const alerts = [];
  function muteDialogs() {
    window.confirm = () => true;
    window.alert = m => { alerts.push(String(m)); };
  }

  async function open(id, body) {
    muteDialogs();
    selectScenario(id);
    for (let i = 0; i < 200; i++) {
      if (currentScenarioId === id && editor.value === body) break;
      await sleep(50);
    }
    if (currentScenarioId !== id) throw new Error('シナリオ ' + id + ' を開けませんでした' + (alerts.length ? '（' + alerts[alerts.length - 1] + '）' : ''));
    updatePreview();
  }

  async function build(slug) {
    const src = await load(slug);
    const d = src.data;
    const meta = d.meta || {};
    const rand = makeRand(meta.seed || hashSeed(d.id));
    const pattern = meta.avatarPattern || 'bubbles';
    // 立ち絵を NPC の順に描いてからサムネイルを描く（同じ乱数の並びを使うので、順番を変えると絵が変わる）
    const npcs = arr(d.npcs).map(n => ({
      id: n.id, name: n.name, color: n.color || '', status: n.status || {}, memos: arr(n.memos),
      avatarUrl: /^data:image\//.test(str(n.avatarUrl)) ? n.avatarUrl : (n.avatar ? drawAvatar(n.avatar, n.avatar.pattern || pattern, rand) : '')
    }));
    const thumbnailUrl = drawThumb(src, rand);
    const scenario = {
      id: d.id, title: d.title, content: src.body, system: d.system,
      npcs: npcs, scenes: d.scenes || { nodes: [], edges: [] }, infos: arr(d.infos),
      basicInfo: { items: arr(d.basicInfo && d.basicInfo.items), thumbnailUrl: thumbnailUrl },
      faqs: arr(d.faqs), backMatter: d.backMatter || { sections: [], rights: '' },
      updated_at: new Date().toISOString()
    };
    muteDialogs();
    const res = await API.importScenarios({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), scenarios: [scenario] }, 'merge');
    await open(d.id, src.body);
    return {
      imported: res, appVersion: RELEASE_NOTES[0].version,
      imageKB: { thumbnail: Math.round(thumbnailUrl.length / 1024), avatars: npcs.map(n => n.name + ' ' + Math.round(n.avatarUrl.length / 1024)) }
    };
  }

  async function ensureOpen(slug) {
    const src = await load(slug);
    if (currentScenarioId !== src.data.id || editor.value !== src.body) await open(src.data.id, src.body);
    updatePreview();
    return src;
  }

  // ---------------------------------------------------------------
  // プレビューの検査と網羅
  // ---------------------------------------------------------------
  // detail が偽なら、網羅は「使っていないもの」だけを返す（結果が長いと読み落とすため）
  async function verify(slug, detail) {
    const src = await ensureOpen(slug);
    const d = src.data;
    const problems = previewProblems(arr(d.meta && d.meta.literalAllow));
    const P = msg => problems.push(msg);

    const stored = await idbGet(STORE_SCENARIOS, d.id);
    if (!stored || stored.content !== src.body) P('保存庫の本文が body.md と一致しない（build し直す）');

    const cov = coverage(src);
    cov.drift.docRows = await docRowsDrift(d.meta && d.meta.builtWith);
    if (detail) return { problems: problems, coverage: cov.rows, variety: cov.variety, drift: cov.drift, counts: cov.counts };
    const label = r => r.area + '：' + r.label;
    const variety = {};
    Object.keys(cov.variety).forEach(k => {
      const v = cov.variety[k];
      variety[k] = v.available ? { unused: v.available.filter(x => v.used.indexOf(x) === -1) } : { used: v.used };
      if (v.custom !== undefined) variety[k].custom = v.custom;
    });
    return {
      problems: problems,
      coverage: {
        used: cov.rows.filter(r => r.status === 'used').length,
        unused: cov.rows.filter(r => r.status === 'unused').map(label),
        notApplicable: cov.rows.filter(r => r.status === 'n/a').map(label)
      },
      variety: variety, drift: cov.drift, counts: cov.counts
    };
  }

  // いま previewArea に描かれているものの問題（verify と try で共用）
  function previewProblems(allow) {
    const problems = [];
    const P = msg => problems.push(msg);

    previewArea.querySelectorAll('.info-missing').forEach(e => P('情報の参照切れ：' + e.textContent.trim()));
    previewArea.querySelectorAll('.npc-speech').forEach(e => { if (e.querySelector('.npc-speech-missing')) P('セリフのNPCが未登録：' + e.textContent.trim().slice(0, 40)); });
    previewArea.querySelectorAll('.npc-card.mini').forEach(e => { if (e.textContent.indexOf('未登録') !== -1) P('NPCカードが未登録：' + e.textContent.trim()); });
    previewArea.querySelectorAll('.scene-map-note').forEach(e => P('段落の中に書いた場面図・目次：' + e.textContent.trim()));
    (previewArea.innerText.match(/場面「[^」]*」が見つかりません/g) || []).forEach(m => P('場面図の場面が無い：' + m));
    previewArea.querySelectorAll('h2.scene-title, h3.search-subtitle').forEach(e => { if (/^#/.test(e.textContent.trim())) P('見出しに # が残っている（### を使った？）：' + e.textContent.trim()); });

    const leftovers = (previewArea.innerText.match(LEFTOVER_RE) || []).filter(m => allow.indexOf(m) === -1);
    uniq(leftovers).forEach(m => P('変換されずに残った記法：' + m));
    previewArea.innerText.split('\n').forEach(ln => { if (/^\s*>/.test(ln) && allow.indexOf(ln.trim()) === -1) P('行頭に > が残っている：' + ln.trim().slice(0, 40)); });

    const sideOnly = Array.from(previewArea.querySelectorAll('.row')).filter(r => {
      const m = r.querySelector(':scope > .main-content'), s = r.querySelector(':scope > .side-content');
      return m && s && !m.textContent.trim() && s.textContent.trim();
    });
    sideOnly.forEach(r => P('右の段だけの行（横に並ぶ本文が無い）：' + r.textContent.trim().slice(0, 40)));
    return problems;
  }

  // ---------------------------------------------------------------
  // 案の試し描き（原本を変えずに、足す・直す断片の見え方を確かめる）
  //
  // samples/<slug>/try.md に断片を書いて実行する。そのサンプルのNPC・情報・場面カードのまま描くので、
  // 参照切れも分かる。描いたあとは run.js が撮影してから、プレビューを元に戻す（restore）
  // ---------------------------------------------------------------
  async function tryFragment(slug) {
    const src = await ensureOpen(slug);
    const text = await fetchText('/samples/' + encodeURIComponent(slug) + '/try.md');
    if (text === null) throw new Error('samples/' + slug + '/try.md がありません（試したい断片を書いてから実行する）');
    previewArea.innerHTML = parseMarkdown(norm(text), []);
    const layout = Array.from(previewArea.children).map(el => {
      if (el.classList.contains('row')) {
        const m = el.querySelector(':scope > .main-content'), s = el.querySelector(':scope > .side-content');
        return { 本文: (m ? m.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : '') || '（本文なし）', 右の段: s ? Array.from(s.children).map(c => c.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)) : [] };
      }
      return { 全幅: el.tagName.toLowerCase() + '.' + el.className + '：' + el.textContent.trim().slice(0, 40) };
    });
    return { layout: layout, problems: previewProblems(arr(src.data.meta && src.data.meta.literalAllow)) };
  }

  // ---------------------------------------------------------------
  // 場面の切り出し（section の撮影用）。見出しの題名で探し、次の同じ段以上の見出しの手前までを範囲にする
  // ---------------------------------------------------------------
  function sectionRange(title) {
    const hs = Array.from(previewArea.querySelectorAll('h2.scene-title, h3.search-subtitle, h2.appendix-heading'));
    const level = e => e.matches('h3.search-subtitle') ? 2 : 1;
    const i = hs.findIndex(e => e.textContent.trim() === String(title).trim());
    if (i === -1) return null;
    return { start: hs[i], end: hs.slice(i + 1).find(e => level(e) <= level(hs[i])) || null };
  }
  function sectionBottom(r) { return r.end ? r.end.getBoundingClientRect().top : previewArea.getBoundingClientRect().bottom; }
  function sectionHeight(title) {
    const r = sectionRange(title);
    return r ? sectionBottom(r) - r.start.getBoundingClientRect().top : null;
  }
  function sectionClip(title) {
    const r = sectionRange(title);
    if (!r) return null;
    r.start.scrollIntoView({ block: 'start' });
    const top = Math.max(0, r.start.getBoundingClientRect().top - 4);
    const pa = previewArea.getBoundingClientRect();
    return { x: Math.max(0, pa.left), y: top, width: pa.width, height: Math.max(1, Math.min(window.innerHeight - top, sectionBottom(r) - top + 4)) };
  }

  function coverage(src) {
    const d0 = src.data;
    const sysId = currentSystemId;
    const sys = GAME_SYSTEMS[sysId];
    const q = s => previewArea.querySelectorAll(s).length;
    const ctx = {
      q: q, body: src.body,
      d: { npcs: currentNpcs, scenes: currentScenes, infos: currentInfos, basicInfo: currentBasicInfo, faqs: currentFaqs, backMatter: currentBackMatter }
    };
    const rows = FEATURES.map(f => {
      const applicable = !f.systems || f.systems.indexOf(sysId) !== -1;
      let n = null;
      if (applicable) { try { n = f.count(ctx); } catch (e) { n = 'error: ' + e.message; } }
      return { id: f.id, area: f.area, label: f.label, count: n, status: !applicable ? 'n/a' : (n > 0 ? 'used' : 'unused') };
    });

    const texts = sel => Array.from(previewArea.querySelectorAll(sel)).map(e => e.textContent.trim());
    const colorNames = {};
    Object.keys(INLINE_COLORS).forEach(k => { colorNames[INLINE_COLORS[k].cls] = k; });
    const rollBoxes = Array.from(previewArea.querySelectorAll('.roll-box:not(.san-box)'));
    const variety = {
      成功段階: { available: arr(sys.badges).map(b => b.label), used: uniq(Array.from(previewArea.querySelectorAll('.roll-box:not(.san-box) .result-label')).map(e => e.textContent.trim())) },
      提示タイプ: { available: ROLL_TYPES.concat(['（指定なし）']), used: uniq(rollBoxes.map(b => { const t = b.querySelector('.roll-type-badge'); return t ? t.textContent.trim() : '（指定なし）'; })) },
      文字色: { available: Object.keys(INLINE_COLORS), used: uniq(Array.from(previewArea.querySelectorAll('[class^="ic-"]')).map(e => colorNames[e.className] || e.className)), custom: q('span[style*="color: #"]') },
      レベルの記号: { available: LEVEL_SYMBOLS.map(s => s.id), used: uniq([].concat(...arr(currentBasicInfo.items).map(x => x.kind === 'level' ? [x.symbol] : arr(x.blocks).filter(b => b.kind === 'level').map(b => b.symbol)))) },
      場面の種別: { available: Object.keys(SCENE_KINDS), used: uniq(currentScenes.nodes.map(n => n.kind)) },
      情報の公開対象: { used: uniq(currentInfos.map(x => x.target)) }
    };
    if (sys.hasSanCheck) variety.SANの結果 = { available: arr(sys.sanTiers).map(t => t.label), used: uniq(texts('.san-box .result-label')) };

    const builtWith = d0.meta && d0.meta.builtWith;
    const drift = {
      appVersion: RELEASE_NOTES[0].version,
      builtWith: builtWith || '(記録なし)',
      // builtWith の無い原本（書いている途中の新規）は、全リリースを並べても読みようがないので出さない
      newerReleases: !builtWith ? '(meta.builtWith が未設定。新規なら仕上げで build.appVersion を入れる)' : RELEASE_NOTES.filter(r => cmpVer(r.version, builtWith) > 0).map(r => ({
        version: r.version, date: r.date,
        items: [].concat(...arr(r.sections).map(s => arr(s.items).map(it => '[' + s.title + '] ' + it)))
      })),
      unknownActions: ACTIONS.filter(a => APP_ONLY_ACTIONS.indexOf(a.id) === -1 && !FEATURES.some(f => f.actions.indexOf(a.id) !== -1)).map(a => a.id + '（' + actionName(a) + '）'),
      unknownSystems: Object.keys(GAME_SYSTEMS).filter(k => KNOWN_SYSTEMS.indexOf(k) === -1)
    };

    const counts = {
      chars: src.body.replace(/\s/g, '').length,
      scenes: q('h2.scene-title'), subtitles: q('h3.search-subtitle'),
      npcs: currentNpcs.length, infos: currentInfos.length, faqs: currentFaqs.length,
      rolls: rollBoxes.length, tocItems: q('.toc-item')
    };
    return { rows: rows, variety: variety, drift: drift, counts: counts };
  }

  // 記法の一覧の表（docs/01 §4.1）と DOC_ROWS の突き合わせ。
  // unmapped: 表にあるのに DOC_ROWS に無い行（道具が知らない記法）
  // changedAfter: 原本を作った版の日付より後に、日付の注記が付いた行（規則が変わったかもしれない。確認候補）
  // sameDay: 同じ日付の行（その版にすでにあったかもしれない。newerReleases に関係する行だけ確かめればよい）
  async function docRowsDrift(builtWith) {
    const html = await fetchText(DOC_TABLE.url);
    if (html === null) return { error: DOC_TABLE.url + ' が読めません' };
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const h = Array.from(doc.querySelectorAll('h3')).find(e => e.textContent.trim().startsWith(DOC_TABLE.heading));
    let table = h && h.nextElementSibling;
    while (table && table.tagName !== 'TABLE' && !/^H[1-3]$/.test(table.tagName)) table = table.nextElementSibling;
    if (!table || table.tagName !== 'TABLE') return { error: 'docs/01 §' + DOC_TABLE.heading + ' の表が見つかりません（見出しや表の位置が変わった？ kit.js の DOC_TABLE を直す）' };
    const rel = RELEASE_NOTES.find(r => r.version === builtWith);
    const builtDate = rel ? rel.date : '';
    const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
      const first = tr.cells[0] ? tr.cells[0].textContent.trim() : '';
      const name = first.replace(/（[^）]*\d{4}-\d{2}-\d{2}[^）]*）/g, '').trim();
      const dates = (tr.textContent.match(/\d{4}-\d{2}-\d{2}/g) || []).sort();
      return { name: name, latest: dates[dates.length - 1] || '' };
    });
    // 同じ日に何版も出すことがあるので、原本を作った日と同じ日付の行は別に返す（その版にすでにあったかもしれない）
    const dated = r => r.name + '（' + r.latest + '）';
    return {
      unmapped: rows.filter(r => !Object.prototype.hasOwnProperty.call(DOC_ROWS, r.name)).map(r => r.name),
      changedAfter: builtDate ? rows.filter(r => r.latest && r.latest > builtDate).map(dated) : [],
      sameDay: builtDate ? rows.filter(r => r.latest && r.latest === builtDate).map(dated) : [],
      builtDate: builtDate || '(builtWith の版がリリースノートに無い)'
    };
  }

  // ---------------------------------------------------------------
  // 今ある完成品との差（export で上書きする前に、原本と完成品がずれていなかったかを見る）
  // ---------------------------------------------------------------
  function loadImage(url) {
    return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('画像を読めません')); im.src = url; });
  }
  // 画像は描くたびに、目で区別できない程度（数階調・ごく一部の画素）に揺れることがある。その程度は同じとみなす
  async function sameImage(a, b) {
    if (a === b) return { same: true, exact: true };
    if (!a || !b) return { same: false, note: '片方にしか無い' };
    const [ia, ib] = await Promise.all([loadImage(a), loadImage(b)]);
    if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) return { same: false, note: '大きさが違う' };
    const pixels = im => {
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const pa = pixels(ia), pb = pixels(ib);
    let changed = 0, maxDelta = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d) changed++;
      if (d > maxDelta) maxDelta = d;
    }
    const ratio = changed / (pa.length / 4);
    return { same: maxDelta <= 8 && ratio < 0.01, exact: false, changedPixels: changed, maxDelta: maxDelta };
  }

  async function diffWithFile(slug) {
    const src = await ensureOpen(slug);
    const text = await fetchText('/samples/' + encodeURIComponent(slug) + '.json');
    if (text === null) return { exists: false, note: 'samples/' + slug + '.json はまだありません' };
    const before = JSON.parse(text).scenarios[0];
    const now = (await API.exportScenarios([src.data.id])).scenarios[0];
    // id（取り込むたびに振り直される）・日時・場面カードの座標・画像は、中身の比較から外す（画像は下で別に比べる）
    const SKIP = { id: 1, updated_at: 1, x: 1, y: 1, avatarUrl: 1, avatarId: 1, thumbnailUrl: 1, thumbnailId: 1 };
    const clean = v => JSON.stringify(v, (k, x) => (SKIP[k] ? undefined : x));
    const fields = ['title', 'system', 'content', 'npcs', 'scenes', 'infos', 'basicInfo', 'faqs', 'backMatter'];
    const changed = fields.filter(f => clean(before[f]) !== clean(now[f]));
    let contentAt = null;
    if (changed.indexOf('content') !== -1) {
      const a = String(before.content || '').split('\n'), b = String(now.content || '').split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { contentAt = { line: i + 1, before: (a[i] || '').slice(0, 80), now: (b[i] || '').slice(0, 80) }; break; }
      }
    }
    const images = [];
    const byName = {};
    arr(before.npcs).forEach(n => { byName[n.name] = n.avatarUrl; });
    for (const n of arr(now.npcs)) images.push(Object.assign({ name: '立ち絵：' + n.name }, await sameImage(byName[n.name], n.avatarUrl)));
    images.push(Object.assign({ name: 'サムネイル' }, await sameImage(before.basicInfo && before.basicInfo.thumbnailUrl, now.basicInfo && now.basicInfo.thumbnailUrl)));
    return {
      exists: true,
      same: changed.length === 0 && images.every(x => x.same),
      changedFields: changed,
      contentFirstDiff: contentAt,
      imagesChanged: images.filter(x => !x.same),
      imagesWobbled: images.filter(x => x.same && !x.exact).map(x => x.name + '（' + x.changedPixels + '画素・最大' + x.maxDelta + '階調）')
    };
  }

  // ---------------------------------------------------------------
  // 読み込み直し（書き出したJSONだけで元に戻るか）
  // ---------------------------------------------------------------
  async function roundTrip(slug) {
    const src = await ensureOpen(slug);
    const d = src.data;
    const strip = h => h.replace(/blob:[^"')\s]+/g, 'blob:');
    const before = strip(previewArea.innerHTML);
    muteDialogs();
    // 別のシステムの新しいシナリオに切り替えてから消す（作業中の状態に残った画像で、たまたま一致しないように）
    createScenarioWithSystem(d.system === 'coc6' ? 'emoklore' : 'coc6');
    await API.deleteScenario(d.id);
    const gone = !(await idbGet(STORE_SCENARIOS, d.id));
    const text = await fetchText('/samples/' + encodeURIComponent(slug) + '.json');
    if (text === null) throw new Error('samples/' + slug + '.json がありません（先に export）');
    const file = JSON.parse(text);
    const res = await API.importScenarios(file, 'merge');
    await open(d.id, src.body);
    const after = strip(previewArea.innerHTML);
    let diffAt = -1;
    if (before !== after) { for (let i = 0; i < Math.max(before.length, after.length); i++) { if (before[i] !== after[i]) { diffAt = i; break; } } }
    return {
      deletedBeforeImport: gone, imported: res,
      samePreview: before === after,
      diff: diffAt === -1 ? null : { before: before.slice(Math.max(0, diffAt - 60), diffAt + 120), after: after.slice(Math.max(0, diffAt - 60), diffAt + 120) },
      contentMatchesBody: file.scenarios[0].content === src.body,
      system: currentSystemId,
      avatarsRestored: currentNpcs.filter(n => /^blob:/.test(n.avatarUrl)).length + ' / ' + currentNpcs.length,
      thumbnailRestored: /^blob:/.test(currentBasicInfo.thumbnailUrl),
      fileKB: Math.round(new Blob([text]).size / 1024)
    };
  }

  // ---------------------------------------------------------------
  // システムの定義（新しいサンプルを書く前に、技能名や成功段階を確かめる）
  // ---------------------------------------------------------------
  function systemInfo(id) {
    const sys = GAME_SYSTEMS[id || DEFAULT_SYSTEM_ID];
    if (!sys) return { error: 'system「' + id + '」はありません（' + Object.keys(GAME_SYSTEMS).join(' / ') + '）' };
    const skills = {};
    Object.keys(sys.skills || {}).forEach(cat => { skills[cat] = sys.skills[cat].map(raw => Array.isArray(raw) ? raw[0] + '(' + raw[1] + ')' : raw); });
    return {
      id: sys.id, name: sys.name, gmInfoTag: sys.gmInfoTag, gmInfoLabel: sys.gmInfoLabel,
      abilities: arr(sys.abilities).map(a => a.key + '=' + a.label), abilityRange: sys.abilityMin + '〜' + sys.abilityMax,
      derived: arr(sys.derived).map(a => a.key + '=' + a.label),
      skills: skills,
      skillValueExample: sys.id === 'coc6' ? '"目星:60"' : '"観察眼:Lv1"（Lv0〜3）',
      rollTiers: arr(sys.rollTiers).map(t => t.label),
      badgeAliases: arr(sys.badges).map(b => b.label + ' ← ' + b.match.join(' / ')),
      hasResonanceRoll: !!sys.hasResonanceRoll, hasSanCheck: !!sys.hasSanCheck,
      emotions: sys.emotions || null,
      sanPresets: sys.sanPresets || null, sanTiers: sys.sanTiers ? sys.sanTiers.map(t => t.label) : null,
      sceneKinds: Object.keys(SCENE_KINDS).map(k => k + '=' + SCENE_KINDS[k].label),
      levelSymbols: LEVEL_SYMBOLS.map(s => s.id + '=' + s.on + s.off),
      inlineColors: Object.keys(INLINE_COLORS).map(k => k + '=' + INLINE_COLORS[k].hex),
      appVersion: RELEASE_NOTES[0].version
    };
  }

  return {
    lintSample: async slug => lint(await load(slug)),
    build: build,
    verify: verify,
    roundTrip: roundTrip,
    diff: diffWithFile,
    tryFragment: tryFragment,
    restore: () => { updatePreview(); return true; },
    sectionHeight: sectionHeight,
    sectionClip: sectionClip,
    ensureOpen: async slug => { await ensureOpen(slug); return true; },
    idOf: async slug => (await load(slug)).data.id,
    systemInfo: systemInfo,
    FEATURES: FEATURES
  };
})();
