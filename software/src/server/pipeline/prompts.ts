import type { KindProfile } from './types.ts';
import { DEFAULT_WORD_RANGE, WORD_PRESETS } from './types.ts';
import type { ActPayload, BeatPayload, CharacterPayload, ChapterPlanPayload, EnvPayload, WorldPayload } from './validate.ts';

/**
 * 分阶段 prompt 与确定性 mock 输出（ARCHITECTURE §4.1–§4.3）。
 * 一次模型调用只产一个阶段的一个块/一批 —— 这是「局部重生成」能成立的前提。
 */

export interface StepProject {
  id: string;
  title: string;
  type: string;
  genre: string;
  premise: string;
  targetWords: number;
  styleNotes: string;
}

export interface StepContext {
  project: StepProject;
  profile: KindProfile;
  world?: WorldPayload | null;
  environments?: EnvPayload[];
  characters?: CharacterPayload[];
  acts?: ActPayload[];
  beats?: Array<BeatPayload & { actId: string; actTitle: string }>;
  units?: Array<{ id: string; ordinal: number; title: string; planFunction: string; planSynopsis: string; minWords: number | null; targetWords: number | null; maxWords: number | null }>;
  note?: string;
  previous?: { title: string; synopsis: string; tail: string } | null;
}

export interface BuiltPrompt {
  system: string;
  prompt: string;
  label: string;
}

const SYSTEM_JSON = `你是一位资深中文小说策划编辑，服务于「AI 主导、人工把关」的创作流水线。
你只输出严格 JSON：不要 Markdown 代码围栏，不要解释文字，不要前后缀。
所有字段都必须用中文填写，禁止占位内容（例如「未命名」「角色A」「待定」「TODO」「...」）。`;

const SYSTEM_PROSE = `你是一位优秀的中文小说作者，负责按既定策划写出成品章节。
要求：具体、有细节、有对话与动作，不写提纲式概述，不写"本章将"之类的元叙述。
只输出正文，不要标题、不要解释、不要 Markdown 标题。`;

function meta(context: StepContext): string {
  const { project, profile } = context;
  return [
    `书名：${project.title}`,
    `类型：${project.type === 'short' ? '短篇' : '长篇'}`,
    `题材：${project.genre || '不限'}`,
    project.premise ? `一句话灵感：${project.premise}` : '',
    `全书目标字数：${project.targetWords} 字（${profile.unitLabel}数建议 ${profile.minUnits}–${profile.maxUnits}）`,
    project.styleNotes ? `风格与禁区：${project.styleNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function noteBlock(note?: string): string {
  if (!note) return '';
  return `\n用户对上一版给出的具体修改意见（必须落实）：\n${note}\n`;
}

// ---------------------------------------------------------------------------
// P1
// ---------------------------------------------------------------------------

export function buildWorldPrompt(context: StepContext): BuiltPrompt {
  const prompt = `${meta(context)}${noteBlock(context.note)}

请为这本书设计「世界观基线」，输出 JSON：
{
  "era": "时代与主要地点（40-80 字）",
  "worldRules": "这个世界必须自洽的规则（60-120 字；若是现实题材且不需要超自然规则，输出空字符串并设 worldRulesNotNeeded=true）",
  "worldRulesNotNeeded": false,
  "tone": "基调与母题（30-60 字）",
  "language": "语言习惯与叙事视角（30-60 字）"
}`;
  return { system: SYSTEM_JSON, prompt, label: 'world' };
}

export function buildEnvPrompt(context: StepContext): BuiltPrompt {
  const summary = context.world ? `时代地点：${context.world.era}\n基调：${context.world.tone}\n规则：${context.world.worldRules || '（现实题材，无超自然规则）'}`.slice(0, 300) : '';
  const prompt = `${meta(context)}
世界观摘要：
${summary}
${noteBlock(context.note)}
请设计 2–4 个反复出场的关键环境，输出 JSON（不要多给）：
{ "environments": [ { "name": "名称", "type": "城/村/机构/异境 之一", "mood": "氛围关键词，两个词", "reason": "它为什么必须出现在这个故事里（20-40 字）" } ] }`;
  return { system: SYSTEM_JSON, prompt, label: 'env' };
}

export function buildCharactersPrompt(context: StepContext): BuiltPrompt {
  const world = context.world ? `时代地点：${context.world.era}\n基调：${context.world.tone}` : '';
  const prompt = `${meta(context)}
${world}
${noteBlock(context.note)}
请设计 3–8 位主要人物（必须至少有一位主角），输出 JSON：
{ "characters": [ { "name": "真实姓名", "role": "身份/在故事中的位置（如：主角、女主、反派）", "age": "年龄", "motivation": "他/她真正想要什么（30-60 字）", "personality": "性格与说话方式（30-60 字）", "secret": "不愿被人知道的秘密（可为空字符串）", "tags": ["标签"], "isProtagonist": false } ] }`;
  return { system: SYSTEM_JSON, prompt, label: 'characters' };
}

// ---------------------------------------------------------------------------
// P2
// ---------------------------------------------------------------------------

export function buildActsPrompt(context: StepContext): BuiltPrompt {
  const characters = (context.characters || []).map((item) => `${item.name}（${item.role}）`).join('、');
  const prompt = `${meta(context)}
主要人物：${characters || '（暂无）'}
世界观：${context.world ? context.world.era : '（暂无）'}
${noteBlock(context.note)}
请为这本书设计${context.profile.actLabel}结构，输出 JSON。${context.profile.actLabel}数量 ${context.profile.actRange[0]}–${context.profile.actRange[1]} 个，功能只能取 钩子/推进/转折/揭示/高潮/收束/缓冲 之一，摘要 2–5 句且不少于 15 字：
{ "logline": "主线一句话（不少于 10 字）", "acts": [ { "title": "标题", "function": "功能", "summary": "摘要", "characters": ["出场人物名"] } ] }`;
  return { system: SYSTEM_JSON, prompt, label: 'acts' };
}

export function buildBeatsPrompt(context: StepContext, act: ActPayload, actIndex: number): BuiltPrompt {
  const acts = context.acts || [];
  const before = actIndex > 0 ? `上一${context.profile.actLabel}：${acts[actIndex - 1].title}｜${acts[actIndex - 1].summary.slice(0, 60)}` : '这是第一个' + context.profile.actLabel;
  const after = actIndex < acts.length - 1 ? `下一${context.profile.actLabel}：${acts[actIndex + 1].title}｜${acts[actIndex + 1].summary.slice(0, 60)}` : '这是最后一个' + context.profile.actLabel;
  const characters = (context.characters || []).map((item) => `${item.name}（${item.role}）`).join('、');
  const prompt = `${meta(context)}
主要人物：${characters || '（暂无）'}
${before}
${after}
当前${context.profile.actLabel}：${act.title}｜功能：${act.function}｜摘要：${act.summary}
${noteBlock(context.note)}
请为这${context.profile.actLabel}拆出 2–12 个${context.profile.beatLabel}，输出 JSON：
{ "beats": [ { "title": "标题", "function": "功能（钩子/推进/转折/揭示/高潮/收束/缓冲）", "summary": "具体发生了什么（40-100 字，不少于 15 字）", "plannedChapters": 1, "foreshadow": "埋下或回收的伏笔（可为空字符串）" } ] }`;
  return { system: SYSTEM_JSON, prompt, label: `beats:${actIndex}` };
}

// ---------------------------------------------------------------------------
// P3
// ---------------------------------------------------------------------------

export function buildChapterPlanPrompt(context: StepContext, batchStart: number, batchSize: number): BuiltPrompt {
  const { profile } = context;
  const unit = profile.unitLabel;
  const presets = WORD_PRESETS.map((preset) => `${preset.label} ${preset.minWords}-${preset.maxWords}（目标 ${preset.targetWords}）`).join(' / ');
  const outline = (context.acts || [])
    .map((act, index) => `${act.title}（${act.function}）：${act.summary}`)
    .join('\n');
  const beats = (context.beats || [])
    .map((beat, index) => `${index + 1}. ${beat.actTitle}｜${beat.title}｜${beat.function}｜${beat.summary.slice(0, 80)}｜预计 ${beat.plannedChapters} ${unit}`)
    .join('\n');
  const previousUnit = context.units && context.units.length ? context.units[context.units.length - 1] : null;
  const prompt = `${meta(context)}
${profile.actLabel}结构：
${outline || '（暂无）'}
${profile.beatLabel}清单：
${beats || '（暂无）'}
${previousUnit ? `上一批最后一${unit}：${previousUnit.title}｜${previousUnit.planSynopsis.slice(0, 80)}` : ''}
${noteBlock(context.note)}
请规划第 ${batchStart + 1} 到第 ${batchStart + batchSize} ${unit}（必须正好 ${batchSize} 条，不要多也不要少），输出 JSON。
每${unit}都要有可直接写作的标题、功能（钩子/推进/转折/揭示/高潮/收束/缓冲）、2–5 句大纲（不少于 15 字）、字数范围（min ≤ target ≤ max，最小不小于 ${DEFAULT_WORD_RANGE.minWordsFloor}，最大不超过 ${DEFAULT_WORD_RANGE.maxWordsCeiling}）。三档预设：${presets}。
{ "${profile.kind === 'short' ? 'beats' : 'chapters'}": [ { "title": "标题", "function": "功能", "synopsis": "大纲", "minWords": 2500, "targetWords": 3000, "maxWords": 4000, "characters": ["出场人物名"] } ] }`;
  return { system: SYSTEM_JSON, prompt, label: `plan:${batchStart}` };
}

// ---------------------------------------------------------------------------
// P4
// ---------------------------------------------------------------------------

export function buildWritingPrompt(context: StepContext, unit: { title: string; planFunction: string; planSynopsis: string; minWords: number; targetWords: number; maxWords: number }): BuiltPrompt {
  const { project, profile } = context;
  const characters = (context.characters || []).map((item) => `- ${item.name}（${item.role}）：${item.motivation}`).join('\n');
  const previous = context.previous
    ? `上一${profile.unitLabel}「${context.previous.title}」梗概：${context.previous.synopsis}\n上一${profile.unitLabel}结尾原文（接着写，不要重复）：\n${context.previous.tail}`
    : '这是全书的第一' + profile.unitLabel + '，请直接建立场景与冲突。';
  const prompt = `${meta(context)}
世界观：${context.world ? `${context.world.era}｜${context.world.tone}｜${context.world.worldRules || '无超自然规则'}` : '（暂无）'}
人物：
${characters || '（暂无）'}
${previous}
${noteBlock(context.note)}
本${profile.unitLabel}规划：
标题：${unit.title}
功能：${unit.planFunction}
大纲：${unit.planSynopsis}

本章目标 ${unit.targetWords} 字，可接受范围 ${unit.minWords}–${unit.maxWords} 字。
请写足情节与场景，不要为凑字数灌水，不要写"（未完）""待续"之类占位。
结尾必须留一个让读者想看下一${profile.unitLabel}的钩子。`;
  return { system: SYSTEM_PROSE, prompt, label: `write:${unit.title}` };
}

// ---------------------------------------------------------------------------
// 确定性 mock 输出（仅当用户显式把 mock 供应商设为默认模型时使用）
// ---------------------------------------------------------------------------

const MOCK_FUNCTIONS = ['钩子', '推进', '转折', '揭示', '高潮', '收束'];

export function mockStepText(op: string, context: StepContext, extra: { actIndex?: number; batchStart?: number; batchSize?: number; unit?: { title: string; targetWords: number } } = {}): string {
  const { project, profile } = context;
  if (op === 'world') {
    return JSON.stringify({
      era: `${project.title}所处时代与主要地点：一座正在扩建的沿海城市，旧城区的巷子与新城区的玻璃幕墙交替出现，故事大多发生在夜里与清晨。`,
      worldRules: profile.requiresWorldRules ? '所有超常现象都有代价：每使用一次，就会遗忘一段与某个人的共同记忆，且遗忘不可逆。' : '',
      worldRulesNotNeeded: !profile.requiresWorldRules,
      tone: '克制的悬疑，带一点温情；母题是「记住」与「被记住」。',
      language: '第三人称限知视角，句子偏短，多留白，少形容词堆叠。',
    });
  }
  if (op === 'env') {
    return JSON.stringify({
      environments: [
        { name: '旧城印刷厂', type: '机构', mood: '铁锈 潮气', reason: '主角的工作地，也是第一条线索被发现的地方。' },
        { name: '潮汐码头', type: '城', mood: '雾 汽笛', reason: '关键证人出现与失踪的场所，连接两代人的秘密。' },
      ],
    });
  }
  if (op === 'characters') {
    return JSON.stringify({
      characters: [
        { name: '沈砚', role: '主角', age: '34', motivation: '查清父亲二十年前突然失踪的真相，同时保住自己仅剩的记忆。', personality: '话少，习惯先观察再开口，对细节有近乎偏执的记忆力。', secret: '他其实已经忘记母亲的脸。', tags: ['调查者'], isProtagonist: true },
        { name: '林见夏', role: '女主', age: '29', motivation: '想离开这座城市，却总被旧案拽回来。', personality: '直率，情绪写在脸上，敢当面戳穿别人。', secret: '她当年在码头看见了什么。', tags: ['证人'], isProtagonist: false },
        { name: '周渡', role: '反派', age: '52', motivation: '把二十年前的交易彻底埋掉，代价是牺牲更多人。', personality: '温和有礼，越平静越危险。', secret: '他才是当年真正下令的人。', tags: ['幕后'], isProtagonist: false },
      ],
    });
  }
  if (op === 'acts') {
    const actCount = profile.kind === 'short' ? 3 : 3;
    const acts = Array.from({ length: actCount }, (_, index) => ({
      title: ['潮声之前', '旧账翻涌', '灯火收束'][index],
      function: MOCK_FUNCTIONS[index] || '推进',
      summary: `第${index + 1}${profile.actLabel}：沈砚在旧城印刷厂发现一张不该存在的排版样张，追查中逐步牵出父亲失踪当晚的码头交易，并被迫在记忆与真相之间做选择。`,
      characters: ['沈砚', '林见夏'],
    }));
    return JSON.stringify({ logline: '一个正在失去记忆的校对员，用最后几个月的记忆追查父亲失踪的真相。', acts });
  }
  if (op.startsWith('beats')) {
    const actIndex = extra.actIndex ?? 0;
    const beats = Array.from({ length: 3 }, (_, index) => ({
      title: `${profile.beatLabel}${index + 1}·${['样张上的名字', '码头的第二个人', '被改写的记忆'][index]}`,
      function: MOCK_FUNCTIONS[(actIndex + index) % MOCK_FUNCTIONS.length],
      summary: `沈砚在${index % 2 ? '潮汐码头' : '旧城印刷厂'}发现新的物证，与林见夏的证词发生冲突，两人决定在当晚再次进入现场，却发现有人提前来过。`,
      plannedChapters: 1,
      foreshadow: index === 1 ? '回收到样张背面的铅笔字' : '',
    }));
    return JSON.stringify({ beats });
  }
  if (op.startsWith('plan')) {
    const start = extra.batchStart ?? 0;
    const size = extra.batchSize ?? 3;
    const entries = Array.from({ length: size }, (_, index) => ({
      title: `第${start + index + 1}${profile.unitLabel}·${['样张', '码头', '旧账'][index % 3]}`,
      function: MOCK_FUNCTIONS[(start + index) % MOCK_FUNCTIONS.length],
      synopsis: `沈砚带着新的物证找到林见夏，两人对同一条线索给出不同解释；夜里的现场多了一个不该出现的脚印，他们必须在被人发现前决定是否继续。`,
      minWords: Math.round(profile.defaultUnitWords * 0.83),
      targetWords: profile.defaultUnitWords,
      maxWords: Math.round(profile.defaultUnitWords * 1.33),
      characters: ['沈砚', '林见夏'],
    }));
    return JSON.stringify({ [profile.kind === 'short' ? 'beats' : 'chapters']: entries });
  }
  // write
  const target = Math.max(300, extra.unit?.targetWords ?? profile.defaultUnitWords);
  const sentences = [
    '印刷厂的老机器停在原地，铁锈混着油墨的味道压下来，像有人把二十年前的空气原样封在了这里。',
    '沈砚把那页样张摊在灯下，纸的纤维已经发黄，可上面的名字清晰得过分，清晰到不像失误。',
    '林见夏没有立刻说话，她把手指按在名字旁边，指甲边缘有一道很浅的旧伤，那是她自己也不愿解释的。',
    '窗外的潮声一阵接一阵，风把没关严的窗棂吹得发响，声音在空车间里折回来，听着像有人在里面走动。',
    '他们决定下到码头的时候，天还没完全黑，路灯一盏一盏亮起来，把水面的波纹切成碎片。',
  ];
  let text = '';
  let index = 0;
  while ([...text].length < target * 0.92) {
    text += sentences[index % sentences.length];
    index += 1;
    if (index % sentences.length === 0) text += '\n\n';
  }
  return text;
}
