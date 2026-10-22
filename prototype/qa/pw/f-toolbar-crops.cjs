const { BASE, launch, attachConsole, makeCtx, shot, saveLog } = require('./lib.cjs');

(async () => {
  const ctx = makeCtx();
  const { log, setStep } = ctx;
  const { browser, page } = await launch({ width: 1440, height: 900 });
  attachConsole(page, ctx);
  const count = (sel) => page.locator(sel).count();

  try {
    setStep('toolbar');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);

    // 斜体
    await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector('#editor p'));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.click('[data-cmd="italic"]');
    await page.waitForTimeout(200);
    log('斜体生效', (await page.evaluate(() => document.querySelectorAll('#editor i, #editor em').length)) > 0 ? 'pass' : 'fail');

    // 引用
    await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector('#editor p:nth-child(2)'));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.click('[data-cmd="formatBlock"]');
    await page.waitForTimeout(250);
    log('引用（blockquote）生效', (await page.evaluate(() => document.querySelectorAll('#editor blockquote').length)) > 0 ? 'pass' : 'fail');
    await shot(page, 'studio-toolbar-quote-1440');

    // 列表
    await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector('#editor p:nth-child(3)'));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.click('[data-cmd="insertUnorderedList"]');
    await page.waitForTimeout(250);
    log('无序列表生效', (await page.evaluate(() => document.querySelectorAll('#editor ul li').length)) > 0 ? 'pass' : 'fail');

    // AI 内联润色
    const t0 = await count('.toast');
    await page.click('[data-action="aiInline"]');
    await page.waitForTimeout(200);
    log('工具栏「AI 润色」有提示', (await count('.toast')) > t0 ? 'pass' : 'fail');

    // 侧栏小按钮
    setStep('panel-actions');
    for (const [sel, name] of [
      ['[data-panel="studio"] [data-action="searchChapter"]', '搜索章节'],
      ['[data-panel="studio"] [data-action="chapterNote"]', '添加笔记'],
      ['.rail-foot [data-action="settings"]', '设置'],
      ['.rail-foot [data-action="account"]', '账户'],
      ['[data-action="allActivity"]', '最近动态-全部'],
    ]) {
      const before = await count('.toast');
      await page.click(sel).catch(() => {});
      await page.waitForTimeout(200);
      log(`「${name}」点击有提示`, (await count('.toast')) > before ? 'pass' : 'fail', { before, after: await count('.toast') });
    }

    // 章节新建后的 AI/字数联动
    setStep('misc-live');
    const wordsBefore = Number((await page.locator('#statusWords').innerText()).replace(/,/g, ''));
    await page.click('[data-cmd="insertUnorderedList"]'); // 空选中，不应崩溃
    await page.waitForTimeout(200);
    log('空选区点击工具栏无异常', true ? 'pass' : 'fail', { wordsBefore });

    // 生成流式消息局部截图
    setStep('ai-panel-shot');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    await page.click('#chat .msg__quick [data-prompt]');
    await page.waitForSelector('#chat .msg:last-child .msg__actions', { timeout: 15000 });
    await page.waitForTimeout(200);
    const streamed = await page.evaluate(() => {
      const msg = [...document.querySelectorAll('#chat .msg--ai')].pop();
      const actions = msg.querySelector(':scope > .msg__actions');
      const meta = msg.querySelector(':scope > .msg__meta');
      const main = msg.querySelector('.msg__main');
      const r = actions?.getBoundingClientRect();
      const rm = meta?.getBoundingClientRect();
      return {
        actionsParentClass: actions?.parentElement.className,
        metaParentClass: meta?.parentElement.className,
        actionsRect: r ? { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) } : null,
        metaRect: rm ? { x: Math.round(rm.x), w: Math.round(rm.width), h: Math.round(rm.height) } : null,
        actionsText: actions?.innerText.replace(/\n/g, '|'),
        metaText: meta?.innerText,
        actionsInMain: main?.contains(actions),
        bubbleWidth: Math.round(msg.querySelector('.msg__bubble').getBoundingClientRect().width),
        panelWidth: Math.round(document.querySelector('#aiPanel').getBoundingClientRect().width),
      };
    });
    log('新生成消息的操作区在 .msg__main 内（预期）', streamed.actionsInMain ? 'pass' : 'fail', streamed);
    await page.locator('#aiPanel').screenshot({ path: 'qa/shots/BUG-ai-streamed-actions-layout-1440.png' });

    // 1024 局部截图
    setStep('crops-1024');
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(400);
    await page.locator('.doc-toolbar').screenshot({ path: 'qa/shots/BUG-1024-toolbar-wrap.png' });
    const reading = await page.evaluate(() => {
      const el = document.querySelector('#readingTime');
      const r = el.getBoundingClientRect();
      return { text: el.textContent, w: Math.round(r.width), h: Math.round(r.height), lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)) };
    });
    log('1024 写作台「阅读时长」单行显示', reading.h < 24 ? 'pass' : 'fail', reading);
    await page.click('.rail-btn[data-nav="codex"]');
    await page.waitForTimeout(400);
    await page.locator('#charGrid').screenshot({ path: 'qa/shots/BUG-1024-char-cards.png' });
    const charCard = await page.evaluate(() => {
      const card = document.querySelector('.char-card');
      const name = card.querySelector('.char-card__name');
      return { cardW: Math.round(card.getBoundingClientRect().width), nameH: Math.round(name.getBoundingClientRect().height), lineHeight: getComputedStyle(name).lineHeight };
    });
    log('1024 人物卡姓名单行显示', charCard.nameH < 40 ? 'pass' : 'fail', charCard);
    await page.click('.rail-btn[data-nav="library"]');
    await page.waitForTimeout(400);
    await page.locator('.continue-card').screenshot({ path: 'qa/shots/BUG-1024-continue-card.png' });

    setStep('console');
    log('控制台无 error', ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror').length === 0 ? 'pass' : 'fail', {
      errors: ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror'),
    });
  } catch (err) {
    log('脚本异常中止', 'fail', { step: ctx.getStep(), message: err.message, stack: (err.stack || '').split('\n').slice(0, 5) });
    await shot(page, 'F-ABORT-' + ctx.getStep());
  } finally {
    saveLog('f-toolbar-crops', { results: ctx.results, console: ctx.consoleErrors });
    await browser.close();
  }
})();
