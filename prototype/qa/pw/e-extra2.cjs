const { BASE, launch, attachConsole, makeCtx, shot, saveLog } = require('./lib.cjs');

(async () => {
  const ctx = makeCtx();
  const { log, setStep } = ctx;
  const { browser, page } = await launch({ width: 1440, height: 900 });
  attachConsole(page, ctx);
  const text = (sel) => page.locator(sel).first().innerText();
  const count = (sel) => page.locator(sel).count();

  try {
    setStep('persistence');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const ed = document.querySelector('#editor');
      const p = document.createElement('p');
      p.textContent = '刷新持久化测试段落';
      ed.appendChild(p);
    });
    await page.waitForTimeout(1100);
    const savedState = await page.evaluate(() => ({
      save: document.querySelector('#saveText').textContent,
      topbarWords: document.querySelector('#topbarActions .tb-words')?.textContent.trim(),
      chapterWords: document.querySelector('#chapterWords').textContent,
      today: document.querySelector('.doc-statusbar__right')?.textContent.trim(),
      note: document.querySelector('[data-panel="studio"] .panel-note p').textContent,
    }));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    const afterReload = await page.evaluate(() => ({
      hasText: document.querySelector('#editor').innerText.includes('刷新持久化测试段落'),
      chapterWords: document.querySelector('#chapterWords').textContent,
    }));
    log('刷新后已保存内容仍然存在（自动保存应持久化）', afterReload.hasText ? 'pass' : 'fail', { savedState, afterReload });
    await shot(page, 'BUG-reload-lost-content-1440');

    // 本章笔记是否随章节变化
    setStep('panel-note');
    await page.click('[data-chapter="ch8"]');
    await page.waitForTimeout(300);
    const noteCh8 = await page.evaluate(() => document.querySelector('[data-panel="studio"] .panel-note p').textContent);
    await page.click('[data-chapter="ch9"]');
    await page.waitForTimeout(300);
    const noteCh9 = await page.evaluate(() => ({
      note: document.querySelector('[data-panel="studio"] .panel-note p').textContent,
      goal: document.querySelector('.goal-mini strong').textContent.trim(),
    }));
    log('「本章笔记」随章节/项目更新', noteCh8 !== savedState.note || noteCh9.note !== noteCh8 ? 'pass' : 'fail', { ch7: savedState.note, ch8: noteCh8, ch9: noteCh9.note });
    log('新建/切换章节后今日目标与进度保持静态（设计或状态）', noteCh9.goal.includes('1,820') ? 'info' : 'fail', noteCh9);

    // 空输入发送
    setStep('ai-empty');
    await page.click('[data-chapter="ch7"]');
    await page.waitForTimeout(250);
    const msgBefore = await count('#chat .msg');
    await page.click('#aiSend');
    await page.waitForTimeout(300);
    const emptySend = await page.evaluate(() => ({
      msgs: document.querySelectorAll('#chat .msg').length,
      streaming: document.querySelector('#aiSend').disabled,
      toast: document.querySelectorAll('.toast').length,
    }));
    log('空输入点发送：不产生消息且有提示', emptySend.msgs === msgBefore && emptySend.toast > 0 ? 'pass' : 'fail', { msgBefore, emptySend });

    // 复制按钮
    setStep('ai-copy');
    const copyBtns = await page.locator('[data-action="copyAI"]').count();
    if (copyBtns > 0) {
      await page.locator('[data-action="copyAI"]').first().click();
      await page.waitForTimeout(250);
      log('「复制」点击有 toast 反馈', (await count('.toast')) > 0 ? 'pass' : 'fail');
    }

    // 向导焦点陷阱
    setStep('wizard-focus-trap');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.lib-head [data-open="newProject"]');
    await page.waitForTimeout(300);
    let escaped = null;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        const modal = document.querySelector('#newProjectModal');
        return { tag: el?.tagName, id: el?.id, cls: el?.className, inModal: modal.contains(el) };
      });
      if (!info.inModal) {
        escaped = { i, info };
        break;
      }
    }
    log('向导弹窗应把 Tab 焦点限制在弹窗内', escaped ? 'fail' : 'pass', escaped || {});
    if (escaped) await shot(page, 'BUG-wizard-focus-escape-1440');
    await page.keyboard.press('Escape');

    // 作品库删除/更多菜单动作
    setStep('project-info');
    await page.click('.project-card[data-project="fog"] [data-action="projectMenu"]');
    await page.waitForTimeout(250);
    const beforeToast = await count('.toast');
    await page.click('.popover [data-action="projectInfo"]');
    await page.waitForTimeout(250);
    log('作品菜单「作品信息」有反馈', (await count('.toast')) > beforeToast ? 'pass' : 'fail');
    await page.click('.project-card[data-project="fog"] [data-action="projectMenu"]');
    await page.waitForTimeout(200);
    await page.click('.popover [data-action="export"]');
    await page.waitForTimeout(300);
    log('作品菜单「导出作品」打开导出弹窗', await page.locator('#exportModal').isVisible() ? 'pass' : 'fail');
    await shot(page, 'export-from-library-menu-1440');
    await page.keyboard.press('Escape');

    setStep('console');
    log('控制台无 error', ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror').length === 0 ? 'pass' : 'fail', {
      errors: ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror'),
    });
  } catch (err) {
    log('脚本异常中止', 'fail', { step: ctx.getStep(), message: err.message, stack: (err.stack || '').split('\n').slice(0, 5) });
    await shot(page, 'E-ABORT-' + ctx.getStep());
  } finally {
    saveLog('e-extra2', { results: ctx.results, console: ctx.consoleErrors });
    await browser.close();
  }
})();
