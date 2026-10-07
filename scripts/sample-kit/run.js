// サンプルの道具の入口（使い方は README.md）。本体は driver.js。全文が毎回出力に出ないよう、ここでは読み込むだけにしている
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!/^https?:/.test(origin)) return { error: '先に browser_navigate で http://localhost:8000/index.html?kit=<slug>&steps=… を開いてください' };
  const code = await page.evaluate(u => fetch(u).then(r => r.ok ? r.text() : Promise.reject(new Error(u + ' が読めません'))), origin + '/scripts/sample-kit/driver.js?v=' + Date.now());
  return (0, eval)('(' + code + '\n)')(page);
}
