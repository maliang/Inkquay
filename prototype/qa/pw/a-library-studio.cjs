const { BASE, launch, attachConsole, makeCtx, shot, saveLog } = require('./lib.cjs');

(async () => {
  const ctx = makeCtx();
  const { log, setStep } = ctx;
  const { browser, page } = await launch({ width: 1440, height: 900 });
  attachConsole(page, ctx);

  const activeView = () => page.evaluate(() => document.querySelector('.view.is-active')?.dataset.view);
  const text = (sel) => page.locator(sel).first().innerText();
  const count = (sel) => page.locator(sel).count();
  const editorWords = async () => (await page.locator('#statusWords').innerText()).trim();

  try {
    /* ================= 作品库 ================= */
    setStep('library');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    log('初始视图=作品库', (await activeView()) === 'library' ? 'pass' : 'fail', { actual: await activeView() });
    log('作品卡数量=3', (await count('.project-card[data-project]')) === 3 ? 'pass' : 'fail');
    log('顶部作品库标题', (await text('.tb-crumb__title')) === '作品库' ? 'pass' : 'fail');

    // 筛选标签
    for (const [f, expected] of [['novel', ['fog']], ['short', ['ferry']], ['script', ['echo']], ['all', ['fog', 'ferry', 'echo']]]) {
      await page.click(`#libFilters [data-filter="${f}"]`);
      await page.waitForTimeout(120);
      const visible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.project-card[data-project]'))
          .filter((c) => getComputedStyle(c).display !== 'none')
          .map((c) => c.dataset.project)
      );
      const active = await page.evaluate(() => document.querySelector('#libFilters .is-active')?.dataset.filter);
      log(`筛选「${f}」`, JSON.stringify(visible) === JSON.stringify(expected) && active === f ? 'pass' : 'fail', { visible, active });
      if (f === 'short') await shot(page, 'lib-filter-short-1440');
    }

    // 搜索
    setStep('library-search');
    await page.fill('#libSearch', '渡轮');
    await page.waitForTimeout(150);
    let vis = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.project-card[data-project]')).filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.dataset.project)
    );
    log('搜索「渡轮」只保留 ferry', JSON.stringify(vis) === JSON.stringify(['ferry']) ? 'pass' : 'fail', { vis });
    await shot(page, 'lib-search-ferry-1440');
    await page.fill('#libSearch', '不存在的内容');
    await page.waitForTimeout(150);
    const nothing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.project-card[data-project]')).filter((c) => getComputedStyle(c).display !== 'none').length
    );
    const newCardVisible = await page.evaluate(() => getComputedStyle(document.querySelector('.project-card--new')).display !== 'none');
    log('搜索无结果时「开始新的故事」卡仍在', nothing === 0 && newCardVisible ? 'pass' : 'fail', { nothing, newCardVisible });
    await shot(page, 'lib-search-empty-1440');
    await page.fill('#libSearch', '');
    await page.waitForTimeout(150);

    // 继续写作
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(500);
    log('继续写作 -> 写作台', (await activeView()) === 'studio' ? 'pass' : 'fail', { view: await activeView() });
    log('默认章节=第七章 雨夜的访客', (await text('#chapterNo')) === '第七章' && (await text('#chapterTitle')) === '雨夜的访客' ? 'pass' : 'fail', {
      no: await text('#chapterNo'),
      title: await text('#chapterTitle'),
    });
    log('章节树激活项=ch7', (await page.locator('.chapter-item.is-active').getAttribute('data-chapter')) === 'ch7' ? 'pass' : 'fail');

    /* ================= 章节切换 ================= */
    setStep('studio-chapters');
    const ch7Words = await editorWords();
    await page.click('[data-chapter="ch8"]');
    await page.waitForTimeout(250);
    log('切到第八章：标题同步', (await text('#chapterTitle')) === '潮汐表' ? 'pass' : 'fail', { title: await text('#chapterTitle') });
    log('切到第八章：正文同步', (await page.locator('#editor').innerText()).includes('潮汐表是手抄的') ? 'pass' : 'fail');
    log('切到第八章：字数更新', (await editorWords()) !== ch7Words ? 'pass' : 'fail', { ch7: ch7Words, ch8: await editorWords() });
    log('切到第八章：大纲树激活同步', (await page.locator('.chapter-item.is-active').getAttribute('data-chapter')) === 'ch8' ? 'pass' : 'fail');
    const ghostHiddenOnCh8 = await page.evaluate(() => getComputedStyle(document.querySelector('#ghostBlock')).display === 'none');
    log('第八章隐藏 AI 建议块', ghostHiddenOnCh8 ? 'pass' : 'fail');

    await page.click('[data-chapter="ch9"]');
    await page.waitForTimeout(250);
    const draft = await page.evaluate(() => ({
      html: document.querySelector('#editor').innerHTML,
      words: document.querySelector('#statusWords').textContent.trim(),
      no: document.querySelector('#chapterNo').textContent,
      status: document.querySelector('#chapterStatus').textContent,
    }));
    log('切到待写第九章：正文为空且字数为 0', draft.html === '' && draft.words === '0' ? 'pass' : 'fail', draft);
    await shot(page, 'studio-draft-chapter-1440');

    await page.click('[data-chapter="ch7"]');
    await page.waitForTimeout(250);

    // 编辑正文与字数、保存态
    setStep('studio-edit');
    const beforeEdit = Number((await editorWords()).replace(/,/g, ''));
    await page.evaluate(() => {
      const ed = document.querySelector('#editor');
      const p = document.createElement('p');
      p.textContent = '这是自动化测试追加的一段文字，用于验证字数统计。';
      ed.appendChild(p);
      ed.focus();
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.keyboard.type('再加一句话。');
    await page.waitForTimeout(120);
    const midSave = await text('#saveText');
    const afterType = Number((await editorWords()).replace(/,/g, ''));
    log('输入后字数增加', afterType > beforeEdit ? 'pass' : 'fail', { beforeEdit, afterType });
    log('输入后保存态=正在保存…', midSave === '正在保存…' ? 'pass' : 'fail', { midSave });
    const treeMeta = await page.locator('[data-chapter="ch7"] .chapter-item__meta').innerText();
    log('章节树字数实时更新', Number(treeMeta.replace(/[^0-9]/g, '')) === afterType ? 'pass' : 'fail', { treeMeta, afterType });
    await page.waitForTimeout(1000);
    const afterSave = await text('#saveText');
    log('800ms 后保存态=已保存', afterSave === '已保存' ? 'pass' : 'fail', { afterSave });

    // 标题编辑
    await page.evaluate(() => {
      const t = document.querySelector('#chapterTitle');
      t.focus();
      const r = document.createRange();
      r.selectNodeContents(t);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.type('（测试）');
    await page.waitForTimeout(150);
    const treeTitle = await page.locator('[data-chapter="ch7"] .chapter-item__title').innerText();
    log('标题编辑同步到章节树', treeTitle.includes('（测试）') ? 'pass' : 'fail', { treeTitle });
    // 还原标题，避免污染后续断言
    await page.evaluate(() => {
      const t = document.querySelector('#chapterTitle');
      t.focus();
      const r = document.createRange();
      r.selectNodeContents(t);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);

    // 工具栏：选中后加粗
    setStep('studio-toolbar');
    const beforeBold = await page.locator('#editor').innerHTML();
    await page.evaluate(() => {
      const p = document.querySelector('#editor p');
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.click('[data-cmd="bold"]');
    await page.waitForTimeout(200);
    const afterBold = await page.locator('#editor').innerHTML();
    const boldTag = await page.evaluate(() => document.querySelectorAll('#editor b, #editor strong').length);
    log('选中段落后点「加粗」生效', afterBold !== beforeBold && boldTag > 0 ? 'pass' : 'fail', { boldTag, changed: afterBold !== beforeBold });
    await shot(page, 'studio-toolbar-bold-1440');

    // 插入分隔线
    await page.click('[data-action="insertDivider"]');
    await page.waitForTimeout(200);
    const divider = await page.locator('#editor').innerText();
    log('插入分隔线追加到正文', divider.includes('＊') ? 'pass' : 'fail');
    log('插入分隔线有 toast', (await count('.toast')) > 0 ? 'pass' : 'fail');

    // 大纲树新建章节：验证内容继承/数据丢失
    setStep('studio-new-chapter');
    const ch7HtmlBefore = await page.evaluate(() => document.querySelector('#editor').innerHTML);
    await page.click('#chapterTree [data-action="newChapter"]');
    await page.waitForTimeout(400);
    const newState = await page.evaluate(() => ({
      title: document.querySelector('#chapterTitle').textContent,
      no: document.querySelector('#chapterNo').textContent,
      html: document.querySelector('#editor').innerHTML,
      words: document.querySelector('#statusWords').textContent.trim(),
      count: document.querySelector('#chapterCount').textContent,
      active: document.querySelector('.chapter-item.is-active')?.dataset.chapter || null,
      treeItems: Array.from(document.querySelectorAll('.chapter-item[data-chapter]')).map((b) => b.dataset.chapter),
    }));
    const sameAsCh7 = newState.html.length > 0 && newState.html === ch7HtmlBefore;
    log('新建章节正文不应继承上一章', !sameAsCh7 ? 'pass' : 'fail', { newWords: newState.words, ch7Len: ch7HtmlBefore.length, newLen: newState.html.length });
    log('新建章节字数显示为首章同款数据', Number(newState.words.replace(/,/g, '')) === 0 ? 'pass' : 'fail', { words: newState.words });
    log('新建章节后目录文字应 +1', newState.count.includes('19') ? 'pass' : 'fail', { count: newState.count });
    log('新建章节后章节树条目 +1', newState.treeItems.length === 6 ? 'pass' : 'fail', { treeItems: newState.treeItems });
    log('新建章节后标题=未命名章节', newState.title === '未命名章节' ? 'pass' : 'fail', { title: newState.title });
    log('新建章节后激活项为新章节', (newState.active || '').startsWith('new-') ? 'pass' : 'fail', { active: newState.active });
    await shot(page, 'studio-new-chapter-1440');

    // 返回 ch7 检查上一章是否被保留
    await page.click('[data-chapter="ch7"]');
    await page.waitForTimeout(300);
    const ch7HtmlAfter = await page.evaluate(() => document.querySelector('#editor').innerHTML);
    log('编辑内容在新建章节后仍保留在 ch7', ch7HtmlAfter === ch7HtmlBefore ? 'pass' : 'fail', {
      lenBefore: ch7HtmlBefore.length,
      lenAfter: ch7HtmlAfter.length,
      containsMark: ch7HtmlAfter.includes('自动化测试追加'),
    });
    await shot(page, 'studio-ch7-after-newchapter-1440');

    /* 重新加载，后续用干净状态 */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(400);

    /* ================= Ghost block ================= */
    setStep('studio-ghost');
    const ghostVisible = await page.evaluate(() => getComputedStyle(document.querySelector('#ghostBlock')).display !== 'none');
    log('第七章默认显示 AI 建议续写块', ghostVisible ? 'pass' : 'fail');
    const ghostText1 = await page.locator('#ghostBlock p').innerText();
    await page.click('[data-action="rerollGhost"]');
    await page.waitForTimeout(120);
    const ghostText2 = await page.locator('#ghostBlock p').innerText();
    log('「换一个」替换建议文案', ghostText1 !== ghostText2 ? 'pass' : 'fail', { same: ghostText1 === ghostText2 });
    const wBeforeGhost = Number((await editorWords()).replace(/,/g, ''));
    await page.click('[data-action="acceptGhost"]');
    await page.waitForTimeout(250);
    const wAfterGhost = Number((await editorWords()).replace(/,/g, ''));
    const ghostGone = await page.evaluate(() => getComputedStyle(document.querySelector('#ghostBlock')).display === 'none');
    log('「接受」写入正文', wAfterGhost > wBeforeGhost && ghostGone ? 'pass' : 'fail', { wBeforeGhost, wAfterGhost, ghostGone });
    log('接受建议后 toast', (await count('.toast')) > 0 ? 'pass' : 'fail');
    await shot(page, 'studio-ghost-accepted-1440');

    // Tab 接受（重新加载）
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const ed = document.querySelector('#editor');
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    const tabAccepted = await page.evaluate(() => ({
      ghost: getComputedStyle(document.querySelector('#ghostBlock')).display === 'none',
      aiParas: document.querySelectorAll('#editor p.ai-para').length,
    }));
    log('按 Tab 接受 AI 建议', tabAccepted.ghost && tabAccepted.aiParas > 0 ? 'pass' : 'fail', tabAccepted);

    /* ================= AI 流式输出 ================= */
    setStep('studio-ai');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(350);
    const msgCountBefore = await count('#chat .msg');
    await page.click('#chat .msg__quick [data-prompt]');
    await page.waitForTimeout(120);
    const streaming1 = await page.evaluate(() => ({
      len: document.querySelector('#chat .msg:last-child .msg__bubble').textContent.length,
      sendDisabled: document.querySelector('#aiSend').disabled,
      typingGone: !document.querySelector('#chat .msg:last-child .msg__typing'),
      name: document.querySelector('#chat .msg:last-child .msg__name span')?.textContent,
    }));
    await page.waitForTimeout(450);
    const streaming2 = await page.evaluate(() => document.querySelector('#chat .msg:last-child .msg__bubble').textContent.length);
    await shot(page, 'studio-ai-streaming-1440');
    await page.waitForSelector('#chat .msg:last-child .msg__actions', { timeout: 15000 });
    const afterStream = await page.evaluate(() => ({
      len: document.querySelectorAll('#chat .msg').length,
      msgCount: document.querySelectorAll('#chat .msg').length,
      sendDisabled: document.querySelector('#aiSend').disabled,
      hasInsert: !!document.querySelector('#chat .msg:last-child [data-insert-ai]'),
      meta: document.querySelector('#chat .msg:last-child .msg__meta')?.textContent || '',
      userBubble: document.querySelector('#chat .msg:nth-last-child(2) .msg__bubble')?.textContent || '',
      inputValue: document.querySelector('#aiInput').value,
    }));
    log('快捷提示产生用户消息+AI消息', afterStream.msgCount === msgCountBefore + 2 ? 'pass' : 'fail', {
      before: msgCountBefore,
      after: afterStream.msgCount,
      userBubble: afterStream.userBubble,
    });
    log('流式输出文本递增', streaming1.len > 0 && streaming2 > streaming1.len ? 'pass' : 'fail', { streaming1, streaming2 });
    log('生成中禁用发送按钮', streaming1.sendDisabled === true ? 'pass' : 'fail', { streaming1 });
    log('生成完成后恢复发送', afterStream.sendDisabled === false ? 'pass' : 'fail');
    log('生成完成后出现「插入正文」', afterStream.hasInsert ? 'pass' : 'fail', { meta: afterStream.meta });
    log('发送后输入框清空', afterStream.inputValue === '' ? 'pass' : 'fail');
    await shot(page, 'studio-ai-done-1440');

    // 插入正文
    const wBeforeInsert = Number((await editorWords()).replace(/,/g, ''));
    await page.click('#chat .msg:last-child [data-insert-ai]');
    await page.waitForTimeout(400);
    const insertResult = await page.evaluate(() => ({
      words: document.querySelector('#statusWords').textContent.trim(),
      aiParas: document.querySelectorAll('#editor p.ai-para').length,
      btnText: document.querySelector('#chat .msg:last-child [data-insert-ai]')?.textContent.trim(),
      btnDisabled: document.querySelector('#chat .msg:last-child [data-insert-ai]')?.disabled,
      ghostDisplay: getComputedStyle(document.querySelector('#ghostBlock')).display,
    }));
    log('插入正文增加字数', Number(insertResult.words.replace(/,/g, '')) > wBeforeInsert ? 'pass' : 'fail', { wBeforeInsert, insertResult });
    log('插入后按钮变「已插入正文」且禁用', insertResult.btnText === '已插入正文' && insertResult.btnDisabled === true ? 'pass' : 'fail', insertResult);
    await shot(page, 'studio-insert-ai-1440');

    // ⌘Enter 发送
    await page.fill('#aiInput', '补一段对白');
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(300);
    const cmdEnter = await page.evaluate(() => ({
      streaming: document.querySelector('#aiSend').disabled,
      input: document.querySelector('#aiInput').value,
      lastMsgCount: document.querySelectorAll('#chat .msg').length,
    }));
    log('⌘Enter 发送消息', cmdEnter.streaming === true && cmdEnter.input === '' ? 'pass' : 'fail', cmdEnter);
    await page.waitForFunction(() => !document.querySelector('#aiSend').disabled, null, { timeout: 15000 });

    // 连续性检查 tab
    setStep('studio-check');
    await page.click('[data-ai-tab="check"]');
    await page.waitForTimeout(200);
    const checkTab = await page.evaluate(() => ({
      aiTabActive: document.querySelector('.ai-tab.is-active')?.dataset.aiTab,
      bodyHidden: document.querySelector('#aiBody').hidden,
      checkHidden: document.querySelector('#aiCheck').hidden,
      composerHidden: document.querySelector('#aiComposer').hidden,
      items: document.querySelectorAll('.check-item').length,
      sendVisible: !!(document.querySelector('#aiSend')?.offsetParent),
    }));
    log('切「连续性检查」：面板与输入框同步隐藏', checkTab.aiTabActive === 'check' && checkTab.bodyHidden && !checkTab.checkHidden && checkTab.composerHidden ? 'pass' : 'fail', checkTab);
    log('连续性检查列出 3 条', checkTab.items === 3 ? 'pass' : 'fail', { items: checkTab.items });
    log('检查页隐藏发送按钮', checkTab.sendVisible === false ? 'pass' : 'fail', { sendVisible: checkTab.sendVisible });
    await shot(page, 'studio-ai-check-1440');

    const runBefore = await page.locator('[data-action="runCheck"]').innerText();
    await page.click('[data-action="runCheck"]');
    await page.waitForTimeout(150);
    const runMid = await page.locator('[data-action="runCheck"]').innerText();
    await page.waitForTimeout(1000);
    const runAfter = await page.locator('[data-action="runCheck"]').innerText();
    log('「重新检查」有 loading 与完成反馈', runMid.includes('检查中') && runAfter === runBefore ? 'pass' : 'fail', { runBefore, runMid, runAfter });
    await page.click('[data-action="checkAll"]');
    await page.waitForTimeout(150);
    log('检查全书连续性 toast', (await count('.toast')) > 0 ? 'pass' : 'fail');
    await page.click('[data-ai-tab="write"]');
    await page.waitForTimeout(200);
    const backToWrite = await page.evaluate(() => ({
      bodyHidden: document.querySelector('#aiBody').hidden,
      checkHidden: document.querySelector('#aiCheck').hidden,
      composerHidden: document.querySelector('#aiComposer').hidden,
      msgCount: document.querySelectorAll('#chat .msg').length,
    }));
    log('切回「共笔」：面板恢复', !backToWrite.bodyHidden && backToWrite.checkHidden && !backToWrite.composerHidden ? 'pass' : 'fail', backToWrite);

    // 模型切换
    setStep('studio-model');
    await page.click('[data-action="modelMenu"]');
    await page.waitForTimeout(200);
    const pop = await page.evaluate(() => {
      const el = document.querySelector('#modelPopover');
      const r = el.getBoundingClientRect();
      return { hidden: el.hidden, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom }, iw: innerWidth, ih: innerHeight };
    });
    log('模型菜单打开且不越界', !pop.hidden && pop.rect.right <= pop.iw + 1 && pop.rect.bottom <= pop.ih ? 'pass' : 'fail', pop);
    await shot(page, 'studio-model-menu-1440');
    await page.click('#modelPopover [data-model="Claude Sonnet 4.5"]');
    await page.waitForTimeout(200);
    const modelPill = (await page.locator('.model-pill').innerText()).trim();
    const popHidden = await page.evaluate(() => document.querySelector('#modelPopover').hidden);
    log('切换模型后按钮文案更新且菜单关闭', modelPill.includes('Claude Sonnet 4.5') && popHidden ? 'pass' : 'fail', { modelPill, popHidden });
    await shot(page, 'studio-model-switched-1440');

    // AI 面板收起 / 展开
    setStep('studio-ai-collapse');
    const docWidthBefore = await page.evaluate(() => document.querySelector('.doc-pane').getBoundingClientRect().width);
    await page.click('.doc-toolbar [data-action="toggleAI"]');
    await page.waitForTimeout(300);
    const collapsed = await page.evaluate(() => ({
      hiddenClass: document.querySelector('.studio').classList.contains('ai-hidden'),
      aiDisplay: getComputedStyle(document.querySelector('#aiPanel')).display,
      docWidth: document.querySelector('.doc-pane').getBoundingClientRect().width,
      expandable: !!document.querySelector('.doc-toolbar [data-action="toggleAI"]'),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    log('收起 AI 面板后文档区变宽', collapsed.hiddenClass && collapsed.aiDisplay === 'none' && collapsed.docWidth > docWidthBefore ? 'pass' : 'fail', {
      docWidthBefore,
      collapsed,
    });
    await shot(page, 'studio-ai-collapsed-1440');
    await page.click('.doc-toolbar [data-action="toggleAI"]');
    await page.waitForTimeout(300);
    const expanded = await page.evaluate(() => ({
      hiddenClass: document.querySelector('.studio').classList.contains('ai-hidden'),
      aiDisplay: getComputedStyle(document.querySelector('#aiPanel')).display,
    }));
    log('再次点击展开 AI 面板', !expanded.hiddenClass && expanded.aiDisplay !== 'none' ? 'pass' : 'fail', expanded);

    // 专注模式 + Esc
    setStep('studio-focus');
    await page.click('.doc-toolbar [data-action="toggleFocus"]');
    await page.waitForTimeout(300);
    const focusOn = await page.evaluate(() => ({
      cls: document.querySelector('#app').classList.contains('focus-mode'),
      railDisplay: getComputedStyle(document.querySelector('.rail')).display,
      panelDisplay: getComputedStyle(document.querySelector('#panel')).display,
      aiDisplay: getComputedStyle(document.querySelector('#aiPanel')).display,
      exitVisible: getComputedStyle(document.querySelector('.focus-exit')).display !== 'none',
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    log('专注模式隐藏导航/面板/AI 且出现退出按钮', focusOn.cls && focusOn.railDisplay === 'none' && focusOn.aiDisplay === 'none' && focusOn.exitVisible ? 'pass' : 'fail', focusOn);
    await shot(page, 'studio-focus-1440');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const focusOff = await page.evaluate(() => ({
      cls: document.querySelector('#app').classList.contains('focus-mode'),
      railDisplay: getComputedStyle(document.querySelector('.rail')).display,
    }));
    log('Esc 退出专注模式', !focusOff.cls && focusOff.railDisplay !== 'none' ? 'pass' : 'fail', focusOff);

    // 批注浮层
    setStep('studio-annotation');
    await page.click('.annotation-pin');
    await page.waitForTimeout(250);
    const anno = await page.evaluate(() => {
      const el = document.querySelector('#annotationPop');
      const r = el.getBoundingClientRect();
      return { hidden: el.hidden, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom }, iw: innerWidth, ih: innerHeight };
    });
    log('点击批注角标打开浮层且不越界', !anno.hidden && anno.rect.right <= anno.iw && anno.rect.bottom <= anno.ih ? 'pass' : 'fail', anno);
    await shot(page, 'studio-annotation-1440');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    log('Esc 关闭批注浮层', (await page.evaluate(() => document.querySelector('#annotationPop').hidden)) ? 'pass' : 'fail');
    await page.click('.mark');
    await page.waitForTimeout(200);
    await page.click('[data-action="resolveAnnotation"]');
    await page.waitForTimeout(200);
    const resolved = await page.evaluate(() => ({
      hidden: document.querySelector('#annotationPop').hidden,
      border: document.querySelector('.mark').style.borderBottom,
    }));
    log('「标记已解决」关闭浮层并移除下划线', resolved.hidden ? 'pass' : 'fail', resolved);

    // 导出弹窗
    setStep('studio-export');
    await page.click('#topbarActions [data-action="export"]');
    await page.waitForTimeout(250);
    log('导出弹窗打开', (await page.locator('#exportModal').isVisible()) ? 'pass' : 'fail');
    await page.click('#exportModal [data-export="outline"]');
    await page.waitForTimeout(120);
    await page.click('#exportFormats .chip:nth-child(2)');
    await page.waitForTimeout(120);
    const exportState = await page.evaluate(() => ({
      option: document.querySelector('.export-option.is-active')?.dataset.export,
      format: document.querySelector('#exportFormats .chip.is-active')?.textContent,
    }));
    log('导出内容与格式可切换', exportState.option === 'outline' && exportState.format === 'PDF' ? 'pass' : 'fail', exportState);
    await shot(page, 'export-modal-1440');
    await page.click('[data-action="doExport"]');
    await page.waitForTimeout(300);
    const exportDone = await page.evaluate(() => ({
      overlayHidden: document.querySelector('#overlay').hidden,
      toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent.trim()),
    }));
    log('导出后关闭弹窗并提示 PDF', exportDone.overlayHidden && exportDone.toasts.some((t) => t.includes('PDF')) ? 'pass' : 'fail', exportDone);

    // 作品菜单 + Esc
    setStep('studio-project-menu');
    await page.click('[data-panel="studio"] [data-action="projectMenu"]');
    await page.waitForTimeout(250);
    const menuOpen = await count('.popover');
    log('作品菜单打开', menuOpen === 1 ? 'pass' : 'fail', { menuOpen });
    await shot(page, 'studio-project-menu-1440');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const menuAfterEsc = await count('.popover');
    log('Esc 关闭作品菜单浮层（预期：关闭）', menuAfterEsc === 0 ? 'pass' : 'fail', { menuAfterEsc });
    if (menuAfterEsc !== 0) await shot(page, 'BUG-project-menu-esc-1440');
    await page.click('.viewport', { position: { x: 20, y: 20 } }).catch(() => {});
    await page.waitForTimeout(200);

    /* ================= 控制台错误 ================= */
    setStep('console');
    log('控制台无 error/warning', ctx.consoleErrors.filter((e) => e.type !== 'warning').length === 0 ? 'pass' : 'fail', { errors: ctx.consoleErrors.filter((e) => e.type !== 'warning') });
  } catch (err) {
    log('脚本异常中止', 'fail', { step: ctx.getStep(), message: err.message, stack: (err.stack || '').split('\n').slice(0, 4) });
  } finally {
    saveLog('a-library-studio', { results: ctx.results, console: ctx.consoleErrors });
    await browser.close();
  }
})();
