// サンプルシナリオの組み立てと検証（Playwright 側の本体）。run.js が読み込んで実行する。使い方と工程の一覧は README.md。
// 引数を受け取れないので、対象と工程は開いているページのURL（?kit=<slug>&steps=…）から読む。
async (page) => {
  const url = new URL(page.url());
  const params = url.searchParams;
  const slug = params.get('kit');
  const steps = (params.get('steps') || 'lint,build,verify').split(',').map(s => s.trim()).filter(Boolean);
  const has = s => steps.indexOf(s) !== -1;
  if (!/^https?:$/.test(url.protocol)) {
    return { error: 'http://localhost:8000/index.html?kit=… を browser_navigate で開いてから実行してください（今のページ: ' + page.url() + '）' };
  }
  const origin = url.origin;

  // コンソールのエラー・警告と、ページで起きた例外を集める（リスナーは1回だけ付ける）
  page.__kitLog = [];
  if (!page.__kitHooked) {
    page.__kitHooked = true;
    page.on('pageerror', e => { if (page.__kitLog) page.__kitLog.push('pageerror: ' + e.message); });
    page.on('console', m => {
      const t = m.type();
      // favicon.ico（アプリに無い）と thumb.js（任意のファイル）の 404 は、誤りではないので数えない
      if (/(favicon\.ico|\/thumb\.js)/.test((m.location().url || '') + ' ' + m.text())) return;
      if ((t === 'error' || t === 'warning') && page.__kitLog) page.__kitLog.push(t + ': ' + m.text());
    });
  }

  // 開き直して、前回の実行の状態を持ち越さない
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(origin + '/index.html?' + params.toString() + '&v=' + Date.now());
  await page.waitForFunction(() => typeof API !== 'undefined' && typeof previewArea !== 'undefined' && !!previewArea && typeof selectScenario === 'function');
  await page.addScriptTag({ url: origin + '/scripts/sample-kit/kit.js?v=' + Date.now() });

  const out = { slug: slug, steps: steps };
  const run = async (name, fn) => {
    if (out.failed) return;
    try { out[name] = await fn(); }
    catch (e) { out[name] = { error: String((e && e.message) || e) }; out.failed = name; }
  };
  const finish = () => { out.console = page.__kitLog.slice(); return out; };
  // 画面より背の高い要素は見切れるので、撮る前に画面の高さを要素に合わせる（撮り終えたら 800 に戻す）
  const fitHeight = async h => page.setViewportSize({ width: 1280, height: Math.min(6000, Math.max(800, Math.ceil(h) + 320)) });
  const shotsDir = 'samples/' + slug + '/shots/';

  if (has('system')) await run('system', () => page.evaluate(id => SampleKit.systemInfo(id), params.get('system')));
  if (!slug) return finish();

  if (has('lint')) {
    await run('lint', () => page.evaluate(s => SampleKit.lintSample(s), slug));
    if (out.lint && out.lint.errors && out.lint.errors.length && !has('force')) {
      out.stopped = 'lint にエラーがあるため build 以降は実行していません。原本を直して再実行してください';
      return finish();
    }
  }
  if (has('build')) await run('build', () => page.evaluate(s => SampleKit.build(s), slug));
  if (has('verify')) await run('verify', () => page.evaluate(a => SampleKit.verify(a[0], a[1]), [slug, params.get('detail') === '1']));
  // export で上書きする前に、今ある完成品と比べる
  if (has('diff')) await run('diff', () => page.evaluate(s => SampleKit.diff(s), slug));

  if (has('export')) await run('export', async () => {
    await page.evaluate(s => SampleKit.ensureOpen(s), slug);
    const id = await page.evaluate(s => SampleKit.idOf(s), slug);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.evaluate(i => exportOneScenario(i), id)
    ]);
    const path = 'samples/' + slug + '.json';
    await download.saveAs(path);
    return { saved: path };
  });

  if (has('roundtrip')) await run('roundtrip', () => page.evaluate(s => SampleKit.roundTrip(s), slug));

  if (has('pdf')) await run('pdf', async () => {
    await page.evaluate(s => SampleKit.ensureOpen(s), slug);
    await page.emulateMedia({ media: 'print' });
    try {
      const path = 'samples/' + slug + '/' + slug + '.pdf';
      const buf = await page.pdf({ path: path, format: 'A4', printBackground: true, margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
      const s = buf.toString('latin1');
      return { saved: path, pages: (s.match(/\/Type\s*\/Page[^s]/g) || []).length, links: (s.match(/\/Subtype\s*\/Link/g) || []).length, kb: Math.round(buf.length / 1024) };
    } finally {
      await page.emulateMedia({ media: 'screen' });
    }
  });

  if (has('shots')) await run('shots', async () => {
    await page.evaluate(s => SampleKit.ensureOpen(s), slug);
    const dir = 'samples/' + slug + '/shots/';
    const P = '#preview-area ';
    const targets = [
      ['01-cover', P + '.scenario-cover'],
      ['02-toc', P + '.scenario-toc'],
      ['03-map', P + '.scene-map-block'],
      ['04-speech', P + '.row:has(.npc-speech)'],
      ['05-npc-card', P + '.row:has(.main-content .npc-card:not(.mini))'],
      ['06-roll', P + '.row:has(.roll-box:not(.san-box))'],
      ['07-resonance', P + '.row:has(.resonance-box)'],
      ['07-san', P + '.row:has(.san-box)'],
      ['08-info', P + '.row:has(.info-block)'],
      ['09-tips', P + '.row:has(.side-note)'],
      ['10-faq', P + '.scenario-faq'],
      ['11-backmatter', P + '.scenario-backmatter']
    ];
    const saved = [], skipped = [];
    try {
      for (const [name, sel] of targets) {
        const loc = page.locator(sel).first();
        if (!(await loc.count())) { skipped.push(name); continue; }
        await fitHeight(await loc.evaluate(e => e.getBoundingClientRect().height));
        await loc.scrollIntoViewIfNeeded();
        await loc.screenshot({ path: dir + name + '.png' });
        saved.push(dir + name + '.png');
      }
      // 場面図の画面（場面ツリー）
      await page.evaluate(() => setAppMode('scene'));
      await page.waitForTimeout(500);
      const canvas = page.locator('#scene-canvas');
      if (await canvas.count()) {
        await fitHeight(await canvas.evaluate(e => e.scrollHeight));
        await page.waitForTimeout(300);
        await page.locator('#scene-canvas-wrap').screenshot({ path: dir + '12-scene-tree.png' });
        saved.push(dir + '12-scene-tree.png');
      }
    } finally {
      await page.evaluate(() => setAppMode('write'));
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    return { saved: saved, skipped: skipped };
  });

  // 見出しを指定して、その場面（次の同じ段以上の見出しの手前まで）を撮る。&shot=<見出しの題名> を繰り返し付けられる
  if (has('section')) await run('section', async () => {
    const titles = params.getAll('shot');
    if (!titles.length) throw new Error('&shot=<見出しの題名> を1つ以上付けてください');
    await page.evaluate(s => SampleKit.ensureOpen(s), slug);
    const saved = [], missing = [];
    try {
      for (const t of titles) {
        const h = await page.evaluate(x => SampleKit.sectionHeight(x), t);
        if (h == null) { missing.push(t); continue; }
        await fitHeight(h);
        const clip = await page.evaluate(x => SampleKit.sectionClip(x), t);
        const path = shotsDir + 'section-' + t.replace(/[\\/:*?"<>|\s]/g, '_') + '.png';
        await page.screenshot({ path: path, clip: clip });
        saved.push(path);
      }
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    return { saved: saved, missing: missing };
  });

  // 案の試し描き。samples/<slug>/try.md の断片を描いて行の組み方を返し、shots/try.png に撮ってからプレビューを戻す
  if (has('try')) await run('try', async () => {
    const res = await page.evaluate(s => SampleKit.tryFragment(s), slug);
    try {
      await fitHeight(await page.evaluate(() => previewArea.scrollHeight));
      await page.locator('#preview-area').screenshot({ path: shotsDir + 'try.png' });
      res.saved = shotsDir + 'try.png';
    } finally {
      await page.evaluate(() => SampleKit.restore());
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    return res;
  });

  return finish();
}
