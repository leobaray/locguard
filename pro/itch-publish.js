// Create + configure + publish the LocGuard Pro page on itch, end to end.
'use strict';
const path = require('path');
const { itchContext } = require('/sistemas/blobsmith/tools/itch-lib.js');

const DESC = `
<p><strong>Catch untranslated strings before your players do.</strong></p>
<p>Godot ships localization bugs silently: <code>tr()</code> returns the raw key when a translation is missing, and the built-in POT generator misses strings in <code>.tscn</code>/<code>.tres</code> properties and <code>OptionButton</code> items. LocGuard finds what actually breaks — in the editor and in CI.</p>
<h3>What you get</h3>
<ul>
<li>🧭 <strong>In-editor dock</strong>: click "Scan project", get every finding in a list, double-click to open the offending file</li>
<li>⚙️ <strong>The full CLI</strong> (Node 18+, zero dependencies) with <code>--strict</code> and <code>--json</code> — exits non-zero on errors so your build fails before untranslated text ships</li>
<li>🧱 <strong>CI presets</strong>: GitHub Actions, GitLab CI and a pre-commit hook, ready to copy</li>
</ul>
<h3>What it catches</h3>
<ul>
<li><strong>missing-key</strong> — used in code/scenes but absent from your CSV (includes the .tscn/.tres texts and OptionButton items Godot's POT generator misses)</li>
<li><strong>placeholder drift</strong> — <code>%d</code> vs <code>%s</code>, <code>{0}</code>, <code>{name}</code> mismatches between locales (runtime format bugs)</li>
<li><strong>bbcode-imbalance</strong> — unclosed <code>[b]…[/b]</code> in translated RichTextLabel strings</li>
<li><strong>empty-translation</strong> — a blank locale column: players silently get the untranslated source text</li>
<li><strong>orphan-key</strong>, <strong>newline-key trap</strong>, <strong>overflow budgets</strong> (CLI)</li>
</ul>
<h3>Verified against the real engine</h3>
<p>Every rule is proven by an automated suite that runs Godot 4.7 headless on a project seeded with each defect and asserts it genuinely breaks at runtime. The in-editor dock is kept in parity with the CLI by an automated parity test. If a rule can't be demonstrated in the real engine, it doesn't ship.</p>
<h3>Free CLI</h3>
<p>The CLI core is free and MIT-licensed at <a href="https://github.com/leobaray/locguard">github.com/leobaray/locguard</a>. Pro adds the in-editor dock, CI presets, the commercial license and support — and funds development.</p>
<p><em>From the maker of <a href="https://blobsmith.itch.io/blobsmith">Blobsmith</a>. Questions or bugs → comments below; they get fixed.</em></p>
`;

(async () => {
  const { browser, ctx } = await itchContext();
  const page = await ctx.newPage();

  // ---- create draft ----
  await page.goto('https://itch.io/game/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[name="game[title]"]', 'LocGuard Pro — Godot 4 localization QA');
  await page.fill('input[name="game[short_text]"]', 'Catch untranslated strings, placeholder drift and broken BBCode before your players do. In-editor dock + CLI + CI gate for Godot 4.');
  await page.evaluate(() => {
    const setSel = (name, value) => {
      const s = document.querySelector(`select[name="${name}"]`);
      if (s && s.selectize) { s.selectize.addOption({ value, text: value }); s.selectize.setValue(value); }
      else if (s) { s.add(new Option(value, value)); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    setSel('game[user_classification]', 'tool');
  });
  await page.check('input[name="ai_disclosure[ai_generated]"][value="yes"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll('input[name^="ai_disclosure"]').forEach((el) => {
      if (/code/i.test(el.name)) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });
  await page.locator('button, input[type=submit]').filter({ hasText: /save/i }).first().click();
  await page.waitForURL((u) => !/game\/new/.test(u.href), { timeout: 30000 });
  const editUrl = page.url();
  const gameId = (editUrl.match(/edit\/(\d+)/) || [])[1];
  console.log('created:', editUrl, 'id:', gameId);

  // ---- edit: slug, classification (retry via selectize), price, cover, desc, tags ----
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const slug = document.querySelector('input[name="game[slug]"]');
    slug.value = 'locguard';
    slug.dispatchEvent(new Event('input', { bubbles: true }));
    const cls = document.querySelector('select[name="game[user_classification]"]');
    if (cls && cls.selectize) { cls.selectize.addOption({ value: 'tool', text: 'Tools' }); cls.selectize.setValue('tool'); }
    const tags = document.querySelector('input[name="game[tags]"]');
    if (tags && tags.selectize) {
      ['godot', 'localization', 'game-development', 'tool', 'user-interface', '2d', 'generator']
        .forEach((t) => { tags.selectize.addOption({ value: t, text: t }); tags.selectize.addItem(t, true); });
    }
  });
  await page.click('button.payment_mode_paid');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const inp = document.querySelector('input[name="game[min_price]"]');
    inp.value = '$12.00';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // cover
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.click('button:has-text("Upload Cover Image"), .cover_uploader_drop button'),
  ]);
  await chooser.setFiles('/sistemas/locguard/pro/cover-1260x1000.png');
  await page.waitForFunction(() => document.querySelector('input[name="game[cover_image_id]"]')?.value, { timeout: 60000 });
  // description via redactor
  await page.evaluate((html) => {
    const ta = document.querySelector('textarea[name="game[description]"]');
    const layer = ta.closest('.redactor-box').querySelector('.redactor-layer');
    layer.innerHTML = html;
    ta.value = html;
    layer.dispatchEvent(new Event('input', { bubbles: true }));
  }, DESC.trim());
  await page.locator('button.save_btn').last().click();
  await page.waitForTimeout(3500);

  // readback
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    slug: document.querySelector('input[name="game[slug]"]')?.value,
    cls: document.querySelector('select[name="game[user_classification]"]')?.value,
    mode: document.querySelector('input[name="game[payment_mode]"]')?.value,
    price: document.querySelector('input[name="game[min_price]"]')?.value,
    cover: !!document.querySelector('input[name="game[cover_image_id]"]')?.value,
    tags: document.querySelector('input[name="game[tags]"]')?.value,
    descLen: document.querySelector('textarea[name="game[description]"]')?.value.length,
  }));
  console.log('READBACK:', JSON.stringify(state));
  console.log('GAME_ID=' + gameId);
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
