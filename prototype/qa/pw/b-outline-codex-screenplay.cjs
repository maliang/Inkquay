const { BASE, launch, attachConsole, makeCtx, shot, saveLog } = require('./lib.cjs');

(async () => {
  const ctx = makeCtx();
  const { log, setStep } = ctx;
  const { browser, page } = await launch({ width: 1440, height: 900 });
  attachConsole(page, ctx);

  const activeView = () => page.evaluate(() => document.querySelector('.view.is-active')?.dataset.view);
  const text = (sel) => page.locator(sel).first().innerText();
  const count = (sel) => page.locator(sel).count();
  const editorWords = async () => (await page.locator('#statusWords').innerText()).replace(/,/g, '').trim();

  try {
    /* ================= 数据丢失：编辑后立即新建章节 ================= */
    setStep('studio-new-chapter-loss');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.continue-card [data-open="studio"]');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const ed = document.querySelector('#editor');
      const p = document.createElement('p');
      p.id = 'qa-marker';
      p.textContent = '未保存的新句子XYZ';
      ed.appendChild(p);
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.keyboard.type('！');
    await page.waitForTimeout(80); // 小于 800ms 自动保存窗口
    await page.click('#chapterTree [data-action="newChapter"]');
    await page.waitForTimeout(300);
    const inNew = await page.evaluate(() => document.querySelector('#editor').innerText.includes('未保存的新句子XYZ'));
    await page.click('[data-chapter="ch7"]');
    await page.waitForTimeout(300);
    const backInCh7 = await page.evaluate(() => document.querySelector('#editor').innerText.includes('未保存的新句子XYZ'));
    log('编辑后立即新建章节：内容被写入新章节', inNew ? 'pass' : 'fail', { inNew });
    log('编辑后立即新建章节：原章节保留未保存内容', backInCh7 ? 'pass' : 'fail', { backInCh7 });
    await shot(page, 'BUG-newchapter-data-loss-1440');

    /* ================= 视图切换：项目与 AI 面板不同步 ================= */
    setStep('cross-view');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.project-card[data-project="ferry"]');
    await page.waitForTimeout(400);
    const ferryStudio = await page.evaluate(() => ({
      view: document.querySelector('.view.is-active')?.dataset.view,
      title: document.querySelector('#chapterTitle').textContent,
      welcome: document.querySelector('#aiWelcome')?.textContent || '',
      chips: Array.from(document.querySelectorAll('#memoryChips .memory-chip')).map((c) => c.textContent.trim()),
      tabs: Array.from(document.querySelectorAll('#topbarTabs button')).map((b) => b.textContent),
      note: document.querySelector('[data-panel="studio"] .panel-note p')?.textContent || '',
    }));
    log('打开短篇《最后一班渡轮》进入写作台', ferryStudio.view === 'studio' && ferryStudio.title === '末班船' ? 'pass' : 'fail', ferryStudio);
    log('短篇顶栏只有「正文」tab', JSON.stringify(ferryStudio.tabs) === JSON.stringify(['正文']) ? 'pass' : 'fail', ferryStudio);
    await page.click('.rail-btn[data-nav="outline"]');
    await page.waitForTimeout(300);
    log('从短篇点侧栏「大纲」切换回长篇小说大纲', (await activeView()) === 'outline' && (await text('.tb-project__title')).includes('雾港来信') ? 'pass' : 'fail', {
      view: await activeView(),
      topbar: await text('.tb-project__title'),
    });
    await page.click('.rail-btn[data-nav="studio"]');
    await page.waitForTimeout(300);
    const backStudio = await page.evaluate(() => ({
      topbar: document.querySelector('.tb-project__title')?.textContent,
      welcome: document.querySelector('#aiWelcome')?.textContent || '',
      chips: Array.from(document.querySelectorAll('#memoryChips .memory-chip')).map((c) => c.textContent.trim()),
      firstBubble: document.querySelector('#chat .msg__bubble')?.textContent || '',
      chapterTitle: document.querySelector('#chapterTitle').textContent,
      panelNote: document.querySelector('[data-panel="studio"] .panel-note p')?.textContent || '',
      activeChapter: document.querySelector('.chapter-item.is-active')?.dataset.chapter || null,
    }));
    log('切回写作台后项目=雾港来信', (backStudio.topbar || '').includes('雾港来信') ? 'pass' : 'fail', backStudio);
    log('切回写作台后 AI 欢迎语同步为雾港', backStudio.welcome.includes('雾港来信') && !backStudio.welcome.includes('最后一班渡轮') ? 'pass' : 'fail', {
      welcome: backStudio.welcome,
      firstBubble: backStudio.firstBubble,
    });
    log('切回写作台后记忆 chips 同步', backStudio.chips.includes('缺页的潮汐表') ? 'pass' : 'fail', { chips: backStudio.chips });
    log('切回写作台后章节激活项存在', backStudio.activeChapter === 'ch7' ? 'pass' : 'fail', { activeChapter: backStudio.activeChapter });
    await shot(page, 'BUG-cross-project-ai-panel-1440');

    /* ================= 大纲 ================= */
    setStep('outline');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.rail-btn[data-nav="outline"]');
    await page.waitForTimeout(400);
    const outlineScroll = await page.evaluate(() => {
      const v = document.querySelector('.view--outline');
      return { sh: v.scrollHeight, ch: v.clientHeight, overflowY: getComputedStyle(v).overflowY };
    });
    log('大纲视图可滚动', outlineScroll.sh >= outlineScroll.ch ? 'pass' : 'fail', outlineScroll);

    const beat7 = await page.evaluate(() => ({
      title: document.querySelector('#insightTitle').textContent,
      active: Array.from(document.querySelectorAll('.beat.is-active')).map((b) => b.dataset.beat),
      tip: document.querySelector('#insightTip').textContent,
    }));
    log('默认诊断=第七章且唯一 active', beat7.active.join(',') === '7' ? 'pass' : 'fail', beat7);

    await page.click('.beat[data-beat="8"]');
    await page.waitForTimeout(250);
    const beat8 = await page.evaluate(() => ({
      title: document.querySelector('#insightTitle').textContent,
      text: document.querySelector('#insightText').textContent,
      goal: document.querySelector('#insightGoal').textContent,
      active: Array.from(document.querySelectorAll('.beat.is-active')).map((b) => b.dataset.beat),
      current: Array.from(document.querySelectorAll('.beat.is-current')).map((b) => b.dataset.beat),
      tooltip: document.querySelector('#chartTooltip span').textContent,
      tension: document.querySelector('#chartTooltip strong').textContent,
    }));
    log('点第八章 beat：右侧诊断标题/描述同步', beat8.title === '第八章 · 被撕掉的一页' && beat8.text.includes('档案馆') ? 'pass' : 'fail', beat8);
    log('点第八章 beat：仅一张卡 active', beat8.active.join(',') === '8' ? 'pass' : 'fail', beat8);
    log('原「写作中」卡保留 is-current 高亮', beat8.current.join(',') === '7' ? 'pass' : 'fail', beat8);
    await shot(page, 'outline-beat8-1440');

    await page.click('.beat[data-beat="11"]');
    await page.waitForTimeout(250);
    const beat11 = await page.evaluate(() => ({
      title: document.querySelector('#insightTitle').textContent,
      text: document.querySelector('#insightText').textContent,
      tip: document.querySelector('#insightTip').textContent,
    }));
    log('无 data-insight 的 beat 使用兜底诊断', beat11.title.includes('第十一章') && beat11.text.length > 0 ? 'pass' : 'fail', beat11);

    await page.click('.beat[data-beat="12"]');
    await page.waitForTimeout(250);
    const draftBeat = await page.evaluate(() => ({ title: document.querySelector('#insightTitle').textContent, text: document.querySelector('#insightText').textContent }));
    log('待写 beat（第12章）诊断标题不串号', draftBeat.title.includes('第 12 章') && draftBeat.title.includes('母亲的名字') ? 'pass' : 'fail', draftBeat);

    // 面板分幕列表是否可交互
    setStep('outline-panel');
    const actBefore = await page.evaluate(() => document.querySelector('.act-item.is-active')?.textContent.trim());
    const actCursor = await page.evaluate(() => getComputedStyle(document.querySelector('.act-item:not(.is-active)')).cursor);
    await page.click('.act-item:not(.is-active)');
    await page.waitForTimeout(250);
    const actAfter = await page.evaluate(() => ({
      active: document.querySelector('.act-item.is-active')?.textContent.trim(),
      toast: document.querySelectorAll('.toast').length,
    }));
    log('侧栏分幕条目点击应有反馈（切换幕/大纲定位）', actAfter.toast > 0 || actAfter.active !== actBefore ? 'pass' : 'fail', { actBefore, actAfter, actCursor });
    await shot(page, 'outline-panel-act-1440');

    // 大纲 AI 按钮
    setStep('outline-ai');
    for (const [sel, name] of [
      ['[data-action="diagnose"]', '节奏诊断'],
      ['[data-action="generateOutline"]', 'AI 推演第二幕'],
      ['[data-action="addBeat"]', '添加场景'],
      ['[data-action="reorder"]', '卡片视图'],
    ]) {
      const before = await count('.toast');
      await page.click(sel);
      await page.waitForTimeout(200);
      const after = await count('.toast');
      log(`「${name}」点击有 toast 反馈`, after > before ? 'pass' : 'fail', { before, after });
    }

    // 滚动到大纲底部
    await page.evaluate(() => {
      const v = document.querySelector('.view--outline');
      v.scrollTop = v.scrollHeight;
    });
    await page.waitForTimeout(300);
    await shot(page, 'outline-bottom-1440');

    /* ================= 设定库 ================= */
    setStep('codex');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.rail-btn[data-nav="codex"]');
    await page.waitForTimeout(400);
    const codexBase = await page.evaluate(() => ({
      tab: document.querySelector('.codex-tabs .is-active')?.dataset.codexTab,
      nav: document.querySelector('#codexNav .is-active')?.dataset.codexCat,
      inspector: getComputedStyle(document.querySelector('#codexInspector')).display,
      chars: document.querySelectorAll('.char-card').length,
      hiddenPanes: Array.from(document.querySelectorAll('.codex-pane')).filter((p) => p.hidden).length,
    }));
    log('设定库默认人物 tab + 档案栏可见', codexBase.tab === 'characters' && codexBase.inspector !== 'none' ? 'pass' : 'fail', codexBase);
    log('人物卡 8 张（tab 标签写 12）', codexBase.chars === 8 ? 'pass' : 'fail', codexBase);

    // 人物切换
    await page.click('.char-card[data-char="lin"]');
    await page.waitForTimeout(250);
    const lin = await page.evaluate(() => ({
      name: document.querySelector('#insName').textContent,
      role: document.querySelector('#insRole').textContent,
      age: document.querySelector('#insAge').textContent,
      secret: document.querySelector('#insSecret').textContent,
      tags: document.querySelector('#insTags').textContent.trim(),
      active: document.querySelector('.char-card.is-active')?.dataset.char,
      relations: Array.from(document.querySelectorAll('#insRelations .rel-row strong')).map((n) => n.textContent),
    }));
    log('点林雾：档案全部字段同步', lin.name === '林雾' && lin.age === '28' && lin.secret.includes('日记') && lin.active === 'lin' ? 'pass' : 'fail', lin);
    await shot(page, 'codex-lin-1440');

    await page.click('.char-card[data-char="di"]');
    await page.waitForTimeout(250);
    const di = await page.evaluate(() => ({ name: document.querySelector('#insName').textContent, age: document.querySelector('#insAge').textContent }));
    log('点阿荻：档案同步', di.name === '阿荻' && di.age === '17' ? 'pass' : 'fail', di);

    // tabs
    setStep('codex-tabs');
    const tabResults = [];
    for (const [tab, pane, items] of [
      ['locations', 'locations', '.entity-card'],
      ['organizations', 'organizations', '.entity-card'],
      ['props', 'props', '.entity-card'],
      ['timeline', 'timeline', '.timeline-item'],
      ['foreshadow', 'foreshadow', '.foreshadow-row:not(.foreshadow-row--head)'],
    ]) {
      await page.click(`.codex-tabs [data-codex-tab="${tab}"]`);
      await page.waitForTimeout(250);
      const r = await page.evaluate(
        ({ tab, pane }) => ({
          tabActive: document.querySelector('.codex-tabs .is-active')?.dataset.codexTab,
          navActive: document.querySelector('#codexNav .is-active')?.dataset.codexCat,
          paneVisible: !document.querySelector(`.codex-pane[data-codex-pane="${pane}"]`).hidden,
          otherVisible: Array.from(document.querySelectorAll('.codex-pane')).filter((p) => !p.hidden).length,
          inspector: getComputedStyle(document.querySelector('#codexInspector')).display,
          wide: document.querySelector('#codexBody').classList.contains('is-wide'),
        }),
        { tab, pane }
      );
      r.items = await page.locator(`.codex-pane[data-codex-pane="${pane}"] ${items}`).count();
      r.tab = tab;
      tabResults.push(r);
      log(`切「${tab}」：内容区/侧栏 tab 同步、仅一个 pane 可见`, r.tabActive === tab && r.navActive === tab && r.paneVisible && r.otherVisible === 1 ? 'pass' : 'fail', r);
      if (tab === 'timeline') await shot(page, 'codex-timeline-1440');
      if (tab === 'foreshadow') await shot(page, 'codex-foreshadow-1440');
    }
    log('地点渲染 6 条（tab 标签写 8）', tabResults[0].items === 6 ? 'pass' : 'fail', { items: tabResults[0].items });
    log('组织渲染 4 条', tabResults[1].items === 4 ? 'pass' : 'fail', { items: tabResults[1].items });
    log('道具渲染 6 条', tabResults[2].items === 6 ? 'pass' : 'fail', { items: tabResults[2].items });
    log('时间线渲染 10 条', tabResults[3].items === 10 ? 'pass' : 'fail', { items: tabResults[3].items });
    log('伏笔渲染 5 条', tabResults[4].items === 5 ? 'pass' : 'fail', { items: tabResults[4].items });

    // 返回人物
    await page.click('.codex-tabs [data-codex-tab="characters"]');
    await page.waitForTimeout(250);
    const backChar = await page.evaluate(() => ({
      inspector: getComputedStyle(document.querySelector('#codexInspector')).display,
      wide: document.querySelector('#codexBody').classList.contains('is-wide'),
      active: document.querySelector('.char-card.is-active')?.dataset.char,
      name: document.querySelector('#insName').textContent,
    }));
    log('返回人物 tab：档案栏恢复且保留上次选中人物', backChar.inspector !== 'none' && !backChar.wide && backChar.name === '阿荻' ? 'pass' : 'fail', backChar);
    await shot(page, 'codex-back-characters-1440');

    // 搜索过滤
    setStep('codex-search');
    await page.fill('#codexSearch', '林');
    await page.waitForTimeout(300);
    const searchChar = await page.evaluate(() => ({
      visible: Array.from(document.querySelectorAll('.char-card')).filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.dataset.char),
      total: document.querySelectorAll('.char-card').length,
      inspector: document.querySelector('#insName').textContent,
    }));
    log('人物搜索「林」过滤卡片', searchChar.visible.length > 0 && searchChar.visible.length < searchChar.total ? 'pass' : 'fail', searchChar);
    await shot(page, 'codex-search-1440');
    await page.fill('#codexSearch', '不存在的角色');
    await page.waitForTimeout(300);
    const emptySearch = await page.evaluate(() => ({
      visible: Array.from(document.querySelectorAll('.char-card')).filter((c) => getComputedStyle(c).display !== 'none').length,
      hasEmptyState: !!document.querySelector('.codex-pane.is-active .empty-state, .codex-pane.is-active [class*="empty"]'),
    }));
    log('搜索无结果有空状态提示', emptySearch.visible === 0 && emptySearch.hasEmptyState ? 'pass' : 'fail', emptySearch);
    await shot(page, 'codex-search-empty-1440');

    await page.fill('#codexSearch', '林');
    await page.click('.codex-tabs [data-codex-tab="locations"]');
    await page.waitForTimeout(300);
    const searchTab = await page.evaluate(() => ({
      query: document.querySelector('#codexSearch').value,
      visibleLocations: Array.from(document.querySelectorAll('.entity-card')).filter((c) => getComputedStyle(c).display !== 'none').length,
      totalLocations: document.querySelectorAll('#locationGrid .entity-card').length,
    }));
    log('搜索词在切换 tab 后仍生效于新面板', searchTab.query === '林' && searchTab.visibleLocations < searchTab.totalLocations ? 'pass' : 'fail', searchTab);
    await shot(page, 'BUG-codex-search-tab-switch-1440');
    await page.fill('#codexSearch', '');
    await page.click('.codex-tabs [data-codex-tab="characters"]');
    await page.waitForTimeout(200);

    // 设定库 AI 按钮 / 导出
    setStep('codex-actions');
    for (const [sel, name] of [
      ['[data-action="aiComplete"]', 'AI 补全设定'],
      ['[data-action="newCharacter"]', '新增人物'],
      ['[data-action="deepenCharacter"]', 'AI 深化人物'],
    ]) {
      const before = await count('.toast');
      await page.click(sel);
      await page.waitForTimeout(200);
      const after = await count('.toast');
      log(`「${name}」点击有 toast 反馈`, after > before ? 'pass' : 'fail', { before, after });
    }
    await page.click('#topbarActions [data-action="exportCodex"]');
    await page.waitForTimeout(250);
    log('「导出设定集」打开导出弹窗', await page.locator('#exportModal').isVisible() ? 'pass' : 'fail');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    log('Esc 关闭导出弹窗', await page.evaluate(() => document.querySelector('#overlay').hidden) ? 'pass' : 'fail');

    /* ================= 剧本 ================= */
    setStep('screenplay');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('.project-card[data-project="echo"]');
    await page.waitForTimeout(450);
    const spBase = await page.evaluate(() => ({
      view: document.querySelector('.view.is-active')?.dataset.view,
      scenes: document.querySelectorAll('.scene-item').length,
      activeScene: document.querySelector('.scene-item.is-active')?.dataset.scene,
      heading: document.querySelector('#scriptPage .scene-heading')?.textContent,
      inspector: document.querySelector('#sceneName').textContent,
      modeActive: document.querySelector('#scriptModes .is-active')?.dataset.scriptMode,
      topbarTitle: document.querySelector('.tb-project__title')?.textContent,
      panelHidden: document.querySelector('#panel').hidden,
    }));
    log('作品卡「回声」进入剧本工坊', spBase.view === 'screenplay' && spBase.topbarTitle.includes('回声') ? 'pass' : 'fail', spBase);
    log('分镜板/剧本 segmented 默认剧本正文', spBase.modeActive === 'script' ? 'pass' : 'fail', spBase);
    log('默认场次=12', spBase.activeScene === 's12' ? 'pass' : 'fail', spBase);

    await page.click('.scene-item[data-scene="s13"]');
    await page.waitForTimeout(300);
    const s13 = await page.evaluate(() => ({
      heading: document.querySelector('#scriptPage .scene-heading')?.textContent,
      pageNo: document.querySelector('#pageNo').textContent,
      name: document.querySelector('#sceneName').textContent,
      scores: Array.from(document.querySelectorAll('.score strong')).map((s) => s.textContent),
      cast: Array.from(document.querySelectorAll('#sceneCast span')).map((s) => s.textContent.trim()),
      active: document.querySelector('.scene-item.is-active')?.dataset.scene,
      func: document.querySelector('#sceneFunction').textContent,
    }));
    log('切场 13：正文/页脚/侧栏/评分同步', s13.heading.includes('13.') && s13.pageNo === '13.' && s13.name.includes('场 13') ? 'pass' : 'fail', s13);
    log('切场 13：出场人物同步为 3 人', s13.cast.length === 3 ? 'pass' : 'fail', { cast: s13.cast });
    await shot(page, 'screenplay-s13-1440');

    // 剧本/分镜切换
    await page.click('#scriptModes [data-script-mode="boards"]');
    await page.waitForTimeout(300);
    const boards = await page.evaluate(() => ({
      mode: document.querySelector('#scriptModes .is-active')?.dataset.scriptMode,
      boardsVisible: !document.querySelector('.script-pane[data-script-pane="boards"]').hidden,
      scriptVisible: !document.querySelector('.script-pane[data-script-pane="script"]').hidden,
      cards: document.querySelectorAll('.shot-card').length,
      head: document.querySelector('.board-head h2')?.textContent,
    }));
    log('切「分镜板」：仅分镜面板可见且有 6 张卡', boards.mode === 'boards' && boards.boardsVisible && !boards.scriptVisible && boards.cards === 6 ? 'pass' : 'fail', boards);
    log('分镜板标题与当前场次(13)一致', (boards.head || '').includes('13') ? 'pass' : 'fail', { head: boards.head });
    await shot(page, 'screenplay-boards-1440');

    await page.click('#scriptModes [data-script-mode="script"]');
    await page.waitForTimeout(250);
    const scriptBack = await page.evaluate(() => ({
      mode: document.querySelector('#scriptModes .is-active')?.dataset.scriptMode,
      scriptVisible: !document.querySelector('.script-pane[data-script-pane="script"]').hidden,
      boardsVisible: !document.querySelector('.script-pane[data-script-pane="boards"]').hidden,
    }));
    log('切回「剧本正文」：面板不残留', scriptBack.mode === 'script' && scriptBack.scriptVisible && !scriptBack.boardsVisible ? 'pass' : 'fail', scriptBack);

    // 分镜模式下点场次
    await page.click('#scriptModes [data-script-mode="boards"]');
    await page.waitForTimeout(200);
    await page.click('.scene-item[data-scene="s14"]');
    await page.waitForTimeout(300);
    const sceneWhileBoards = await page.evaluate(() => ({
      mode: document.querySelector('#scriptModes .is-active')?.dataset.scriptMode,
      heading: document.querySelector('#scriptPage .scene-heading')?.textContent,
      name: document.querySelector('#sceneName').textContent,
    }));
    log('分镜模式下点场次 14 自动回到剧本正文', sceneWhileBoards.mode === 'script' && sceneWhileBoards.heading.includes('14.') ? 'pass' : 'fail', sceneWhileBoards);

    // 生成分镜按钮
    await page.click('[data-action="generateBoards"]');
    await page.waitForTimeout(400);
    const genBoards = await page.evaluate(() => ({
      mode: document.querySelector('#scriptModes .is-active')?.dataset.scriptMode,
      head: document.querySelector('.board-head h2')?.textContent,
      name: document.querySelector('#sceneName').textContent,
      toast: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent.trim()).slice(-1)[0],
    }));
    log('「生成这一场分镜」切到分镜板', genBoards.mode === 'boards' ? 'pass' : 'fail', genBoards);
    log('生成分镜后板头与当前场次(14)同步', (genBoards.head || '').includes('14') ? 'pass' : 'fail', genBoards);
    await shot(page, 'BUG-boards-scene-mismatch-1440');

    // 返回作品库
    await page.click('.tb-crumb__back');
    await page.waitForTimeout(400);
    const backLib = await page.evaluate(() => ({
      view: document.querySelector('.view.is-active')?.dataset.view,
      railActive: document.querySelector('.rail-btn.is-active')?.dataset.nav,
      panelHidden: document.querySelector('#panel').hidden,
    }));
    log('剧本页返回作品库：视图/侧栏/面板状态复位', backLib.view === 'library' && backLib.railActive === 'library' && backLib.panelHidden ? 'pass' : 'fail', backLib);
    await shot(page, 'screenplay-back-library-1440');

    setStep('console');
    log('控制台无 error', ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror').length === 0 ? 'pass' : 'fail', {
      errors: ctx.consoleErrors.filter((e) => e.type === 'error' || e.type === 'pageerror'),
    });
  } catch (err) {
    log('脚本异常中止', 'fail', { step: ctx.getStep(), message: err.message, stack: (err.stack || '').split('\n').slice(0, 5) });
    await shot(page, 'B-ABORT-' + ctx.getStep());
  } finally {
    saveLog('b-outline-codex-screenplay', { results: ctx.results, console: ctx.consoleErrors });
    await browser.close();
  }
})();
