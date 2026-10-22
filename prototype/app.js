'use strict';

/* ============================================================
   私家写手 · 原型交互
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  view: 'library',
  project: 'fog',
  chapter: 'ch7',
  aiTab: 'write',
  codexTab: 'characters',
  codexChar: 'shen',
  scriptScene: 's12',
  scriptMode: 'script',
  focus: false,
  aiHidden: false,
  streaming: false,
  ghostAccepted: false,
  wizardStep: 1,
  wizardLoading: false,
  wizardTitle: '潮汐表上没有的名字',
  wizardType: 'novel',
};

/* ============================================================
   数据
   ============================================================ */

const FOG_CH7 = [
  '<p>雨是傍晚开始的。起初只是几粒，敲在玻璃上，像有人用指甲试探一扇不肯开的门；到了夜里，整座雾港都湿透了。</p>',
  '<p>沈砚把最后一页稿纸压在镇纸下，听见楼下传来三声敲门。不轻不重，间隔得像经过丈量。</p>',
  '<p>他没有立刻起身。茶几上摊着那封没有署名的信，信纸边缘被雨水洇过，留下浅褐色的潮痕。第三行有一句话被人用指甲反复划过——<span class="mark" data-note="1">“她还活着，只是不在你记得的地方。”</span><button class="annotation-pin" data-note="1" type="button">3</button></p>',
  '<p>第四声敲门响起时，灯忽然灭了。</p>',
  '<p>黑暗里，沈砚摸到桌角的手电。光柱扫过门缝，照见一双被雨水泡得发亮的皮鞋。鞋尖朝着屋里，像是已经站了很久。</p>',
  '<p>“沈先生。”门外的人说，声音低而平，“我来取一件属于我的东西。”</p>',
  '<p>沈砚没有开门。他先关掉手电，让眼睛重新适应黑暗，然后才把门拉开一条缝。链子绷直，发出细小的金属声。</p>',
  '<p>门外站着一个瘦高的男人，帽檐压得很低。他没有撑伞，雨水顺着帽檐往下滴，在门槛前积成一小片深色的海。他的左手提着一只旧皮箱，箱角包着磨白的铜皮。</p>',
  '<p>“我不认识你。”沈砚说。</p>',
  '<p>“你认识这个。”男人把皮箱抬起来。箱扣上刻着一只展翅的白鸥——十年前沉没的那艘渡轮的名字。</p>',
  '<p>沈砚的手指停在门链上。他听见自己的心跳，一下一下，撞着肋骨。雨声忽然变得很远。</p>',
  '<p>“你是谁？”</p>',
  '<p>男人抬起头。帽檐下面，是一张被水泡过似的、没有表情的脸。</p>',
  '<p>“我是那天没有上船的人。”</p>',
];

const projects = {
  fog: {
    id: 'fog',
    title: '雾港来信',
    mark: '雾',
    cover: 'fog',
    type: '长篇小说',
    genre: '悬疑 · 文学',
    totalWords: 126480,
    goalWords: 300000,
    lastChapter: 'ch7',
    written: 18,
    totalChapters: 24,
    nextChapterNo: 10,
    tabs: [
      { view: 'studio', label: '正文' },
      { view: 'outline', label: '大纲' },
      { view: 'codex', label: '设定' },
    ],
    aiWelcome: '我已读完《雾港来信》前六章、人物档案与 5 条伏笔。第七章要先把气氛压住，还是直接推进访客的身份？',
    memory: ['本章正文', '沈砚', '雾港', '缺页的潮汐表'],
    chapters: [
      {
        id: 'ch5',
        vol: '第一卷 · 潮声',
        no: '第五章',
        title: '被撕掉的一页',
        status: '定稿',
        content: [
          '<p>档案馆的灯管发出细微的嗡鸣。沈砚把那份 2006 年的港务记录摊在桌上，发现第七页不见了。</p>',
          '<p>不是撕掉。有人用刀片沿着装订线裁走了它，切口整齐，像一次外科手术。</p>',
          '<p>他把纸举到灯下，能看见残留的半枚印章。白鸥号的船务章，边缘缺了一角。</p>',
          '<p>管理员在身后咳嗽了一声：“沈老师，这份记录不能外借。”</p>',
          '<p>“我知道。”沈砚把纸放回去，指尖却悄悄记住了缺页的位置，“我只是想确认，十年前的那场事故，到底死了多少人。”</p>',
          '<p>管理员沉默了几秒。窗外的雨声忽然大了。</p>',
        ].join(''),
      },
      {
        id: 'ch6',
        vol: '第一卷 · 潮声',
        no: '第六章',
        title: '灯塔没有影子',
        status: '定稿',
        content: [
          '<p>白塔灯塔在雾里只剩一个轮廓。林雾站在塔顶，听见潮水一遍遍舔着防波堤，像在数一件谁也不肯承认的事。</p>',
          '<p>沈砚爬上最后一级铁梯时，她正把灯罩擦到发亮。“你来晚了。”她说，“潮汐表上写着，今晚十一点四十分，水位会退到警戒线以下。”</p>',
          '<p>“你一直在看潮汐表？”</p>',
          '<p>“灯塔看守人都看。”她没回头，“你妹妹也看。”</p>',
          '<p>沈砚停在原地。风从窗缝灌进来，灯芯轻轻晃了一下。他注意到塔顶的墙上有一道很浅的刻痕，像有人用指甲记下过什么。</p>',
          '<p>“她来过这里。”</p>',
          '<p>林雾终于转过身。她的眼睛很静，静得像退潮后的滩涂。“沈先生，有些地方，来过的人不会留下脚印。”</p>',
        ].join(''),
      },
      {
        id: 'ch7',
        vol: '第二卷 · 暗流',
        no: '第七章',
        title: '雨夜的访客',
        status: '初稿',
        content: FOG_CH7.join(''),
      },
      {
        id: 'ch8',
        vol: '第二卷 · 暗流',
        no: '第八章',
        title: '潮汐表',
        status: '草稿',
        content: [
          '<p>潮汐表是手抄的。蓝黑墨水，字迹瘦而急，像写字的人总在赶时间。</p>',
          '<p>沈砚把纸翻到背面，看见一行被水晕开的字：<strong>“十一点四十，不要上船。”</strong></p>',
          '<p>那是沈鹭的笔迹。</p>',
          '<p>他坐在厨房的小凳上，很久没有动。水壶在灶上烧开，发出尖锐的汽笛声，像很远的地方有一艘船正在离港。</p>',
        ].join(''),
      },
      {
        id: 'ch9',
        vol: '第二卷 · 暗流',
        no: '第九章',
        title: '周隐的谎言',
        status: '待写',
        draft: true,
        content: '',
      },
    ],
  },
  ferry: {
    id: 'ferry',
    title: '最后一班渡轮',
    mark: '渡',
    cover: 'ferry',
    type: '短篇小说',
    genre: '现实主义 · 悬疑',
    totalWords: 8420,
    goalWords: 12000,
    lastChapter: 'f1',
    written: 2,
    totalChapters: 3,
    nextChapterNo: 4,
    tabs: [{ view: 'studio', label: '正文' }],
    aiWelcome: '我已通读《最后一班渡轮》全文与人物设定。要先把悬念收紧，还是补一段老周的过去？',
    memory: ['全文', '老周', '末班渡轮', '三年前的船票'],
    chapters: [
      {
        id: 'f1',
        vol: '短篇 · 三幕',
        no: '第一章',
        title: '末班船',
        status: '修改中',
        content: [
          '<p>晚上十点四十分，最后一班渡轮靠岸。老周把缆绳在桩上绕了三圈，抬头时，看见候船室的灯还亮着。</p>',
          '<p>这个点不该有人。可长椅上坐着一个穿灰呢大衣的女人，脚边放着一只湿透的藤箱。</p>',
          '<p>“姑娘，收船了。”</p>',
          '<p>女人抬起头。她的脸很白，像在水里泡过。“我等的人还没来。”</p>',
          '<p>老周看了一眼墙上的钟。秒针停在十点四十一分，已经停了很久。他忽然想起来，今天不是星期二。</p>',
          '<p>“你等谁？”</p>',
          '<p>女人从口袋里摸出一张船票，递过来。票面上的日期是三年前，乘客姓名一栏，写着他自己的名字。</p>',
        ].join(''),
      },
      {
        id: 'f2',
        vol: '短篇 · 三幕',
        no: '第二章',
        title: '河面下的灯',
        status: '初稿',
        content: [
          '<p>河面很黑，只有渡轮的灯在水里碎成一片。</p>',
          '<p>老周没有开船。他坐在驾驶室里，把那张船票翻来覆去地看。纸张是真的，印章是真的，连右下角那个被烟头烫出的洞，都和他记忆里的一模一样。</p>',
          '<p>三年前，他把这张票送给了一个人。</p>',
          '<p>“你认识我。”女人站在舱门口，声音被发动机的低鸣压得很轻。</p>',
          '<p>“不认识。”老周说。</p>',
          '<p>“那你为什么在发抖？”</p>',
        ].join(''),
      },
      {
        id: 'f3',
        vol: '短篇 · 三幕',
        no: '第三章',
        title: '空座位',
        status: '待写',
        draft: true,
        content: '',
      },
    ],
  },
  echo: {
    id: 'echo',
    title: '回声',
    mark: '回',
    cover: 'echo',
    type: '电影剧本',
    genre: '悬疑 · 家庭',
    totalWords: 102,
    goalWords: 150,
    aiWelcome: '这是《回声》的第二稿。剧本正文、场次分析与分镜板已经准备好。',
    memory: ['剧本第二稿', '林雾', '渡轮底舱'],
  },
};


/* ============================================================
   设置中心数据
   ============================================================ */
const STORAGE_KEYS = {
  appearance: 'pw.settings.appearance.v1',
  providers: 'pw.settings.providers.v1',
  prefs: 'pw.settings.prefs.v1',
};

const THEME_META = {
  ink: { name: '墨夜', sub: '深夜书房' },
  abyss: { name: '雾蓝', sub: '港口夜航' },
  moss: { name: '苔青', sub: '山中清晨' },
  paper: { name: '宣纸', sub: '白日书房' },
};

const ACCENT_PRESETS = {
  cinnabar: { name: '朱砂', dark: '#d4634c', hi: '#e47a61', deep: '#b8563f', light: '#b8503a', lightHi: '#a84632', lightDeep: '#963c2c' },
  jade: { name: '青玉', dark: '#6fb3a4', hi: '#8acbbd', deep: '#4c8a7e', light: '#2f7f70', lightHi: '#276b5f', lightDeep: '#215a50' },
  amber: { name: '琥珀', dark: '#c8a96b', hi: '#dcc28c', deep: '#9b7e45', light: '#8a6a2f', lightHi: '#755925', lightDeep: '#624a1f' },
  indigo: { name: '靛蓝', dark: '#6f8fd0', hi: '#8da9e3', deep: '#4e6ba8', light: '#4767a8', lightHi: '#3a568e', lightDeep: '#304874' },
  violet: { name: '紫藤', dark: '#a88bc9', hi: '#c0a6dd', deep: '#7e649e', light: '#73569a', lightHi: '#604681', lightDeep: '#50396c' },
  graphite: { name: '墨灰', dark: '#8b8f99', hi: '#a6aab3', deep: '#666a73', light: '#5f636c', lightHi: '#4d5159', lightDeep: '#3f434a' },
};

const DEFAULT_APPEARANCE = {
  theme: 'ink',
  accent: 'cinnabar',
  customAccent: null,
  editorSize: 17.5,
  reduceMotion: false,
};

const DEFAULT_PREFS = {
  pov: '第三人称限知',
  genre: '悬疑 · 文学',
  aiLength: '中 · 约 500 字',
  autoSave: true,
  style: '克制留白',
};

const DEFAULT_PROVIDERS = [
  {
    id: 'deepseek', name: 'DeepSeek', family: '国内', mark: 'D', brand: '#4d6bfe',
    baseUrl: 'https://api.deepseek.com', configured: true, enabled: true, key: 'sk-demo-deepseek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3.2', ctx: '128k', tags: ['长文', '中文'] },
      { id: 'deepseek-reasoner', name: 'DeepSeek R2', ctx: '128k', tags: ['推理'] },
    ],
    enabledModels: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat',
  },
  {
    id: 'anthropic', name: 'Anthropic', family: '海外', mark: 'A', brand: '#d97757',
    baseUrl: 'https://api.anthropic.com/v1', configured: true, enabled: true, key: 'sk-ant-demo',
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', ctx: '200k', tags: ['长文', '文风'] },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', ctx: '200k', tags: ['推理', '长文'] },
    ],
    enabledModels: ['claude-sonnet-4-5', 'claude-opus-4-1'], defaultModel: 'claude-sonnet-4-5',
  },
  {
    id: 'openai', name: 'OpenAI', family: '海外', mark: 'O', brand: '#10a37f',
    baseUrl: 'https://api.openai.com/v1', configured: false, enabled: false, key: '',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2', ctx: '128k', tags: ['通用', '结构'] },
      { id: 'o4', name: 'o4', ctx: '200k', tags: ['推理'] },
    ],
    enabledModels: [], defaultModel: 'gpt-5.2',
  },
  {
    id: 'google', name: 'Google Gemini', family: '海外', mark: 'G', brand: '#4285f4',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', configured: false, enabled: false, key: '',
    models: [
      { id: 'gemini-3-5-pro', name: 'Gemini 3.5 Pro', ctx: '1M', tags: ['超长文'] },
      { id: 'gemini-3-5-flash', name: 'Gemini 3.5 Flash', ctx: '1M', tags: ['快速'] },
    ],
    enabledModels: [], defaultModel: 'gemini-3-5-pro',
  },
  {
    id: 'qwen', name: '通义千问', family: '国内', mark: 'Q', brand: '#7a5af5',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', configured: false, enabled: false, key: '',
    models: [
      { id: 'qwen3-8-max', name: 'Qwen3.8 Max', ctx: '128k', tags: ['中文', '长文'] },
      { id: 'qwen3-8-plus', name: 'Qwen3.8 Plus', ctx: '128k', tags: ['性价比'] },
    ],
    enabledModels: [], defaultModel: 'qwen3-8-max',
  },
  {
    id: 'zhipu', name: '智谱 GLM', family: '国内', mark: 'Z', brand: '#3856d6',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', configured: false, enabled: false, key: '',
    models: [
      { id: 'glm-5', name: 'GLM-5', ctx: '128k', tags: ['中文'] },
      { id: 'glm-4-6', name: 'GLM-4.6', ctx: '128k', tags: ['快速'] },
    ],
    enabledModels: [], defaultModel: 'glm-5',
  },
  {
    id: 'moonshot', name: 'Moonshot', family: '国内', mark: 'K', brand: '#8c9199',
    baseUrl: 'https://api.moonshot.cn/v1', configured: false, enabled: false, key: '',
    models: [
      { id: 'kimi-k3', name: 'Kimi K3', ctx: '256k', tags: ['长文', '中文'] },
      { id: 'kimi-k2', name: 'Kimi K2', ctx: '256k', tags: ['通用'] },
    ],
    enabledModels: [], defaultModel: 'kimi-k3',
  },
  {
    id: 'ollama', name: 'Ollama', family: '本地', mark: 'L', brand: '#6f8a80',
    baseUrl: 'http://localhost:11434/v1', configured: false, enabled: false, key: '',
    models: [
      { id: 'llama4-70b', name: 'Llama 4 70B', ctx: '128k', tags: ['本地', '隐私'] },
      { id: 'qwen3-8-32b', name: 'Qwen3.8 32B', ctx: '128k', tags: ['本地', '中文'] },
    ],
    enabledModels: [], defaultModel: 'llama4-70b',
  },
];

const EXTRA_PROVIDERS = [
  {
    id: 'openrouter', name: 'OpenRouter', family: '聚合', mark: 'R', brand: '#8b8fd8',
    baseUrl: 'https://openrouter.ai/api/v1', configured: false, enabled: false, key: '',
    models: [
      { id: 'openrouter-auto', name: 'OpenRouter Auto', ctx: '动态', tags: ['聚合'] },
      { id: 'openrouter-sonnet', name: 'Claude Sonnet 4.5', ctx: '200k', tags: ['长文'] },
    ],
    enabledModels: [], defaultModel: 'openrouter-auto',
  },
  {
    id: 'azure', name: 'Azure OpenAI', family: '企业', mark: 'A', brand: '#3ea6df',
    baseUrl: 'https://{resource}.openai.azure.com/openai/deployments', configured: false, enabled: false, key: '',
    models: [
      { id: 'azure-gpt-5', name: 'gpt-5.2 (deployment)', ctx: '128k', tags: ['企业'] },
    ],
    enabledModels: [], defaultModel: 'azure-gpt-5',
  },
  {
    id: 'vllm', name: 'vLLM', family: '自托管', mark: 'V', brand: '#6fb3a4',
    baseUrl: 'http://localhost:8000/v1', configured: false, enabled: false, key: '',
    models: [
      { id: 'vllm-local', name: '本地部署模型', ctx: '自定义', tags: ['自托管'] },
    ],
    enabledModels: [], defaultModel: 'vllm-local',
  },
  {
    id: 'lmstudio', name: 'LM Studio', family: '本地', mark: 'M', brand: '#a07f3f',
    baseUrl: 'http://localhost:1234/v1', configured: false, enabled: false, key: '',
    models: [
      { id: 'lmstudio-local', name: 'LM Studio 模型', ctx: '自定义', tags: ['本地'] },
    ],
    enabledModels: [], defaultModel: 'lmstudio-local',
  },
];

let appearance = { ...DEFAULT_APPEARANCE };
let settingsPrefs = { ...DEFAULT_PREFS };
let providers = [];
let defaultModel = { providerId: 'deepseek', modelId: 'deepseek-chat' };
let fallbackModel = { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' };
let generationSettings = { temperature: 0.8, streaming: true };
const settingsState = {
  tab: 'appearance',
  editingProvider: null,
  draft: null,
  connection: 'idle',
  catalogQuery: '',
};

const CHARACTERS = {
  shen: {
    name: '沈砚', char: '沈', avatar: 'char-avatar--shen', role: '主角 · 前调查记者', age: '34', appear: '18 章', pov: '主视角',
    tags: ['冷静', '执拗', '失眠'],
    quote: '“雨声像有人在数钱。数到第三遍，门就开了。”',
    desc: '十年前妹妹在雾港失踪，他辞去记者工作，回到这座潮湿的小城。表面在编地方志，实际一直在等一个答案。',
    secret: '他其实收到过妹妹的第二封信，但一直没敢拆。',
    relations: [
      { name: '林雾', char: '林', avatar: 'char-avatar--lin', rel: '互相试探', tension: '张力 82' },
      { name: '周隐', char: '周', avatar: 'char-avatar--zhou', rel: '暗中角力', tension: '张力 91' },
      { name: '沈鹭', char: '鹭', avatar: 'char-avatar--lu', rel: '未完成的告别', tension: '执念' },
    ],
    tip: '沈砚不会主动提问。他的关心通常表现为记住别人说过的细节，然后在下一章用上。',
  },
  lin: {
    name: '林雾', char: '林', avatar: 'char-avatar--lin', role: '女主 · 白塔灯塔看守人', age: '28', appear: '14 章', pov: '第二视角',
    tags: ['寡言', '警觉', '熟悉潮汐'],
    quote: '“有些地方，来过的人不会留下脚印。”',
    desc: '雾港本地人，十八岁那年接替父亲看守白塔灯塔。她记得每一次退潮，也记得沈鹭失踪那晚的潮位。',
    secret: '她保存着沈鹭的日记，却一直没有交给沈砚。',
    relations: [
      { name: '沈砚', char: '沈', avatar: 'char-avatar--shen', rel: '互相试探', tension: '张力 82' },
      { name: '沈鹭', char: '鹭', avatar: 'char-avatar--lu', rel: '旧友 / 愧疚', tension: '秘密' },
      { name: '周隐', char: '周', avatar: 'char-avatar--zhou', rel: '被威胁', tension: '张力 76' },
    ],
    tip: '林雾说话总是先给事实，再给情绪。她的谎言通常不是编造，而是省略。',
  },
  zhou: {
    name: '周隐', char: '周', avatar: 'char-avatar--zhou', role: '反派 · 港务局副局长', age: '52', appear: '11 章', pov: '对手视角',
    tags: ['体面', '圆滑', '控制欲'],
    quote: '“雾港的雾，是为了让大家都体面一点。”',
    desc: '在港务局工作了三十年，经历了白鸥号事故与之后所有的调查。他从不提高音量，也从不真正回答一个问题。',
    secret: '沉船事故当晚的值班记录，是他亲手改的。',
    relations: [
      { name: '沈砚', char: '沈', avatar: 'char-avatar--shen', rel: '暗中角力', tension: '张力 91' },
      { name: '林雾', char: '林', avatar: 'char-avatar--lin', rel: '威胁 / 利用', tension: '张力 76' },
      { name: '老陶', char: '陶', avatar: 'char-avatar--tao', rel: '旧怨', tension: '断裂' },
    ],
    tip: '周隐的威胁永远藏在关心和敬茶里。让他说最狠的话时保持微笑。',
  },
  lu: {
    name: '沈鹭', char: '鹭', avatar: 'char-avatar--lu', role: '关键人物 · 沈砚的妹妹', age: '19', appear: '回忆 / 5 章', pov: '缺席视角',
    tags: ['明亮', '叛逆', '手风琴'],
    quote: '“哥，有些信寄不出去，不是因为找不到地址。”',
    desc: '失踪前在雾港电台做夜间节目，常去白塔灯塔看潮。她留下的最后一句话，是让林雾“别告诉我哥”。',
    secret: '她不是事故的受害者，而是最早发现记录被改的人。',
    relations: [
      { name: '沈砚', char: '沈', avatar: 'char-avatar--shen', rel: '兄妹', tension: '执念' },
      { name: '林雾', char: '林', avatar: 'char-avatar--lin', rel: '旧友', tension: '秘密' },
      { name: '阿荻', char: '荻', avatar: 'char-avatar--di', rel: '目击者', tension: '线索' },
    ],
    tip: '沈鹭只存在于别人的回忆里。每次出场都应带来一个与之前矛盾的小细节。',
  },
  tao: {
    name: '老陶', char: '陶', avatar: 'char-avatar--tao', role: '配角 · 修船匠', age: '63', appear: '7 章', pov: '旁证',
    tags: ['酗酒', '义气', '记性好'],
    quote: '“船沉了，名字还在。人没了，味道还在。”',
    desc: '在白鸥号上做过十二年机修。事故之后戒了船，却戒不掉酒。他记得每一艘船的发动机声音。',
    secret: '事故那晚，他在码头看见周隐的车。',
    relations: [
      { name: '周隐', char: '周', avatar: 'char-avatar--zhou', rel: '旧怨', tension: '断裂' },
      { name: '沈砚', char: '沈', avatar: 'char-avatar--shen', rel: '逐渐信任', tension: '盟友' },
    ],
    tip: '老陶的关键信息总是夹在醉话里，说完自己先笑，像在替别人遮羞。',
  },
  su: {
    name: '苏晚', char: '苏', avatar: 'char-avatar--su', role: '配角 · 电台主播', age: '31', appear: '6 章', pov: '情感线',
    tags: ['温柔', '控制欲', '声音'],
    quote: '“你每次都说最后一次。可你每次都会回来。”',
    desc: '沈砚的前女友，也是沈鹭在电台的同事。她替沈鹭保存过最后一期节目的原始录音。',
    secret: '她剪掉了录音里沈鹭提到的一个名字。',
    relations: [
      { name: '沈砚', char: '沈', avatar: 'char-avatar--shen', rel: '旧情 / 拉扯', tension: '张力 68' },
      { name: '沈鹭', char: '鹭', avatar: 'char-avatar--lu', rel: '同事 / 隐瞒', tension: '秘密' },
    ],
    tip: '苏晚的温柔是一种审问。她越轻声，越接近真相。',
  },
  chen: {
    name: '陈默', char: '陈', avatar: 'char-avatar--chen', role: '配角 · 刑警', age: '40', appear: '8 章', pov: '程序线',
    tags: ['疲惫', '正直', '欠人情'],
    quote: '“程序救不了所有人，但能让我睡得着。”',
    desc: '负责沈鹭失踪案的刑警。案子早已搁置，他却每年重读一次卷宗。沈砚当年帮他写过一篇报道。',
    secret: '他把一份关键证物留在了自己家里。',
    relations: [
      { name: '沈砚', char: '沈', avatar: 'char-avatar--shen', rel: '欠人情', tension: '盟友' },
      { name: '周隐', char: '周', avatar: 'char-avatar--zhou', rel: '上下级压力', tension: '张力 55' },
    ],
    tip: '陈默从不承诺结果，只承诺流程。他的帮助总是迟到半步。',
  },
  di: {
    name: '阿荻', char: '荻', avatar: 'char-avatar--di', role: '线索人物 · 码头少年', age: '17', appear: '5 章', pov: '旁观者',
    tags: ['机灵', '缺钱', '目击者'],
    quote: '“我什么都没看见。但你给我五十，我可以想起来一点。”',
    desc: '在码头替人搬货、看船、跑腿。沈鹭失踪那晚，他在防波堤上放烟花，看见灯塔的光灭了三次。',
    secret: '他拿走了沈鹭落在码头的一盘录音带。',
    relations: [
      { name: '沈鹭', char: '鹭', avatar: 'char-avatar--lu', rel: '目击者', tension: '线索' },
      { name: '林雾', char: '林', avatar: 'char-avatar--lin', rel: '怕她', tension: '张力 42' },
    ],
    tip: '阿荻的每句话都半真半假。让他用讨价还价的方式说出关键信息。',
  },
};

const LOCATIONS = [
  { name: '雾港老城区', meta: '核心舞台', desc: '终年潮湿的港口小城，石板路下面是被填平的老河道。', tags: ['常驻', '雨夜'] },
  { name: '白塔灯塔', meta: '第 3 章登场', desc: '建于清末的白色灯塔，林雾工作与居住的地方。塔顶墙上有一道旧刻痕。', tags: ['林雾', '线索'] },
  { name: '旧海关大楼', meta: '第 8 章登场', desc: '港务局现在的办公楼，地下室保存着 2006 年以前的纸质档案。', tags: ['周隐', '档案'] },
  { name: '潮汐巷 14 号', meta: '第 5 章登场', desc: '沈鹭失踪前租住的阁楼，房东保留着原样。窗台正对白塔灯塔。', tags: ['空房间', '妹妹'] },
  { name: '港务局档案馆', meta: '第 8 章登场', desc: '恒温恒湿的档案库，第七页记录在此消失。', tags: ['缺页', '关键场景'] },
  { name: '白鸥号（沉船）', meta: '十年前', desc: '2006 年 9 月 17 日沉没于雾港外海，官方记录死亡 23 人。', tags: ['事故', '核心谜团'] },
];

const ORGANIZATIONS = [
  { name: '雾港港务局', meta: '权力机构', desc: '掌握港口与档案，周隐在这里工作三十年。表面高效，内部沉默。', tags: ['周隐', '掩盖'] },
  { name: '地方志编辑部', meta: '沈砚单位', desc: '三个人、一间办公室，负责编写没人读的雾港地方志。', tags: ['日常', '掩护'] },
  { name: '白鸥号船务公司', meta: '已注销', desc: '事故后三个月注销，法人代表在第二年移居海外。', tags: ['空壳', '线索'] },
  { name: '雾港电台', meta: '沈鹭单位', desc: '夜间节目《雾中频率》曾是小城唯一的声音。苏晚仍在主持。', tags: ['苏晚', '录音'] },
];

const PROPS = [
  { name: '白鸥号皮箱', meta: '第 7 章', desc: '箱角包着磨白的铜皮，箱扣刻着白鸥。访客带来的核心物件。', tags: ['访客', '身份'] },
  { name: '缺页的潮汐表', meta: '第 3 / 17 章', desc: '手抄潮汐记录，背面有沈鹭的字：“十一点四十，不要上船。”', tags: ['伏笔', '妹妹'] },
  { name: '沈鹭的日记', meta: '第 9 章', desc: '林雾保存了十年。最后三页被海水泡烂，只能辨认出“灯塔”两个字。', tags: ['林雾', '秘密'] },
  { name: '老式录音机', meta: '第 11 章', desc: '从白鸥号底舱打捞上来的机器，居然还能转动。', tags: ['关键道具', '声音'] },
  { name: '黄铜钥匙', meta: '第 6 章', desc: '沈鹭留在灯塔墙缝里的钥匙，对应潮汐巷 14 号的储物间。', tags: ['开启', '空间'] },
  { name: '手风琴', meta: '第 5 / 21 章', desc: '沈鹭的旧物。她失踪后，雾港的夜里偶尔还能听见琴声。', tags: ['伏笔', '回忆'] },
];

const TIMELINE = [
  { date: '2006.09.17', title: '白鸥号沉没', desc: '渡轮在雾港外海沉没，官方记录死亡 23 人。周隐是当晚值班的港务调度。', key: true, tag: '事故' },
  { date: '2006.09.24', title: '第七页被裁走', desc: '港务记录中的值班名单出现缺页，切口整齐。', key: false },
  { date: '2006.10.02', title: '白鸥号船务公司注销', desc: '法人代表移居海外，所有船员档案随之封存。', key: false },
  { date: '2016.05.30', title: '沈鹭回到雾港', desc: '她辞去外地工作，住进潮汐巷 14 号，开始频繁出入灯塔。', key: false },
  { date: '2016.06.02', title: '沈鹭失踪', desc: '当夜灯塔的光熄灭三次。阿荻在防波堤上看见周隐的车。', key: true, tag: '失踪' },
  { date: '2016.06.03', title: '第一次搜索中止', desc: '警方搜索持续十一天，因“无外力侵害迹象”结案。', key: false },
  { date: '2026.10.03', title: '沈砚收到遗嘱', desc: '失踪十年的妹妹被宣告死亡，遗嘱由一位无名律师寄出。', key: true, tag: '现在' },
  { date: '2026.10.11', title: '第一封信', desc: '信上盖着白鸥号的邮戳，内容预报了第二天的天气。', key: true },
  { date: '2026.10.19', title: '雨夜的访客', desc: '一个没有报出名字的男人，带着白鸥号皮箱出现在沈砚家门口。', key: true, tag: '当前' },
  { date: '2026.10.20', title: '故事现在', desc: '沈砚必须在开门的瞬间做出选择：继续回避，还是重新开始。', key: false },
];

const FORESHADOW = [
  { name: '缺页的潮汐表', planted: '第 3 章', payoff: '第 17 章', status: '待回收', cls: 'is-pending' },
  { name: '手风琴声', planted: '第 5 章', payoff: '第 21 章', status: '待回收', cls: 'is-pending' },
  { name: '伞骨划痕', planted: '第 7 章', payoff: '第 14 章', status: '规划中', cls: 'is-plan' },
  { name: '白鸥号船票', planted: '第 2 章', payoff: '第 23 章', status: '已回收', cls: 'is-done' },
  { name: '母亲的名字', planted: '第 9 章', payoff: '第 19 章', status: '待回收', cls: 'is-pending' },
];

const SCENES = [
  {
    id: 's10', group: '第一幕 · 靠岸', no: '10', place: '雾港码头', time: '夜', pages: '2.3',
    heading: '10. 外景 · 雾港码头 · 夜',
    body: [
      '<p class="action">雨刚停。码头上的水洼映着路灯，像一地碎掉的月亮。</p>',
      '<p class="action">沈砚站在白鸥号曾经的泊位前。铁桩上还留着一圈旧漆。</p>',
      '<p class="character">沈砚</p>',
      '<p class="dialogue">二十三加一。</p>',
      '<p class="character">林雾</p>',
      '<p class="dialogue">什么？</p>',
      '<p class="character">沈砚</p>',
      '<p class="dialogue">官方名单二十三个人。可我数了照片，二十四个。</p>',
      '<p class="action">林雾没有看照片。她看的是海面。</p>',
    ].join(''),
    name: '场 10 · 雾港码头',
    scores: ['4.5', '3.5', '4.0'],
    func: '用“多出来的一个人”重新打开事故的规模，让观众意识到官方叙述从一开始就不可靠。',
    subtext: '沈砚数的是照片，林雾看的是海。两个人已经知道彼此在隐瞒什么。',
    tip: '把“二十三加一”留给海浪声之后，不要加解释。',
    cast: ['lin', 'shen'],
  },
  {
    id: 's11', group: '第一幕 · 靠岸', no: '11', place: '雾港码头', time: '清晨', pages: '2.0',
    heading: '11. 外景 · 雾港码头 · 清晨',
    body: [
      '<p class="action">雾贴着水面走。一排空渔船挤在岸边，桅杆像没有写完的字。</p>',
      '<p class="action">林雾提着一只塑料袋，沿着码头走到尽头。沈砚已经在那里，手里捏着一张旧船票。</p>',
      '<p class="character">沈砚</p>',
      '<p class="dialogue">你迟到了四十分钟。</p>',
      '<p class="character">林雾</p>',
      '<p class="dialogue">潮水迟到，我就迟到。</p>',
      '<p class="action">她把塑料袋递过去。里面是一台老式录音机，外壳上有一道被火烧过的痕。</p>',
      '<p class="character">沈砚</p>',
      '<p class="dialogue">哪来的？</p>',
      '<p class="character">林雾</p>',
      '<p class="dialogue">白鸥号。它比你想象的干净。</p>',
      '<p class="transition">切至：</p>',
    ].join(''),
    name: '场 11 · 码头交接',
    scores: ['3.5', '4.0', '4.5'],
    func: '把“录音机”这个关键道具交给沈砚，同时确立林雾的合作是有条件的。',
    subtext: '林雾说船很干净，其实是在说：有人清理过现场。',
    tip: '录音机外壳的烧痕要给一个特写，但不要解释原因。',
    cast: ['lin', 'shen'],
  },
  {
    id: 's12', group: '第二幕 · 回声', no: '12', place: '渡轮底舱', time: '夜', pages: '2.8',
    heading: '12. 内景 · 渡轮底舱 · 夜',
    body: [
      '<p class="action">柴油机的低鸣从舱壁另一侧渗进来，像一头巨兽在梦里翻身。应急灯每三秒闪一次，把堆积的缆绳照成一团团蜷缩的影子。</p>',
      '<p class="action">林雾举着手电，光柱停在最里面的铁柜上。柜门有一道新鲜的划痕。</p>',
      '<p class="character">沈砚 <span class="paren">（画外）</span></p>',
      '<p class="dialogue">你确定是这一艘？</p>',
      '<p class="character">林雾</p>',
      '<p class="dialogue">船号对得上。可这艘船，十年前就沉了。</p>',
      '<p class="action">沈砚从梯口下来，脚步在最后一格停住。他看见铁柜上缠着一截新的麻绳。</p>',
      '<p class="character">沈砚</p>',
      '<p class="dialogue">有人比我们先到。</p>',
      '<p class="action">林雾把手电递给他，自己退后半步。光柱落在柜门的划痕上，三道，平行，像被什么动物的爪子抓过。</p>',
      '<p class="character">林雾</p>',
      '<p class="dialogue">不是爪子。是钥匙。</p>',
      '<p class="action">沈砚把手伸向铁柜。他的指尖刚碰到柜门，录音机自己响了。</p>',
      '<p class="transition">切至：</p>',
    ].join(''),
    name: '场 12 · 渡轮底舱',
    scores: ['5.0', '4.0', '3.5'],
    func: '把“船早已沉没”的事实变成一个视觉证据，让观众先于人物感到不安。',
    subtext: '林雾说“船号对得上”时，真正想说的是：我早就知道你会来。',
    tip: '建议删掉一句解释性对白，让手电的光在划痕上多停一秒。',
    cast: ['lin', 'shen'],
  },
  {
    id: 's13', group: '第二幕 · 回声', no: '13', place: '声音修复室', time: '日', pages: '2.2',
    heading: '13. 内景 · 声音修复室 · 日',
    body: [
      '<p class="action">狭小的房间，墙上贴满吸音棉。示波器上的绿线一跳一跳。</p>',
      '<p class="action">沈砚戴着耳机，把录音带放进机器。林雾站在他身后。</p>',
      '<p class="action">沙沙声。很长的沙沙声。然后，一个女人的声音从十年前的空白里浮出来。</p>',
      '<p class="character">沈鹭 <span class="paren">（录音）</span></p>',
      '<p class="dialogue">哥，如果你听到这个，说明我还是没能回去。</p>',
      '<p class="action">沈砚的手停在旋钮上。他没有回头，但林雾看见他的肩膀轻轻塌了一下。</p>',
      '<p class="character">沈鹭 <span class="paren">（录音）</span></p>',
      '<p class="dialogue">别怪林雾。是我让她别说。</p>',
      '<p class="transition">切至：</p>',
    ].join(''),
    name: '场 13 · 声音修复室',
    scores: ['4.0', '3.0', '5.0'],
    func: '让沈鹭“发声”，把失踪者从线索变成有意志的人物，同时把林雾推向坦白。',
    subtext: '录音里越替林雾开脱，林雾越无法继续沉默。',
    tip: '录音不要一次放完。在“别怪林雾”之后切断，留到下一场。',
    cast: ['shen', 'lin', 'lu'],
  },
  {
    id: 's14', group: '第二幕 · 回声', no: '14', place: '沈砚家', time: '夜', pages: '1.8',
    heading: '14. 内景 · 沈砚家 · 夜',
    body: [
      '<p class="action">茶几上摊着皮箱、船票和那封没有署名的信。三样东西摆成一个不完整的三角形。</p>',
      '<p class="action">沈砚坐在它们中间，像是在等第四样东西出现。</p>',
      '<p class="character">林雾 <span class="paren">（画外）</span></p>',
      '<p class="dialogue">你打算什么时候问我？</p>',
      '<p class="action">沈砚没有回头。他把皮箱的铜扣合上，又打开。</p>',
      '<p class="character">沈砚</p>',
      '<p class="dialogue">等你说实话的时候。</p>',
    ].join(''),
    name: '场 14 · 沈砚家',
    scores: ['3.0', '3.5', '4.0'],
    func: '两个人在同一空间里互相等待，把上一场的声音证据转成关系压力。',
    subtext: '沈砚把铜扣开了又合，是在给自己数时间。',
    tip: '这一场可以更短。让沉默承担一半的对白。',
    cast: ['shen', 'lin'],
  },
];

const SCENE_BOARDS = {
  s10: {
    name: '场 10 · 雾港码头', sub: '6 个镜头 · 预计 22 秒 · AI 生成的分镜草案',
    shots: [
      ['码头夜色', '远景 · 5s', '远景'], ['旧泊位铁桩', '推近 · 4s', '中景'],
      ['照片上的第二十四个人', '特写 · 3s', '特写'], ['林雾望向海面', '侧脸 · 3s', '近景'],
      ['两人一前一后', '宽景 · 4s', '双人'], ['海面反光', '空镜 · 3s', '空镜'],
    ],
  },
  s11: {
    name: '场 11 · 码头交接', sub: '6 个镜头 · 预计 19 秒 · AI 生成的分镜草案',
    shots: [
      ['晨雾码头', '缓慢推进 · 5s', '全景'], ['林雾走入画面', '跟拍 · 3s', '中景'],
      ['塑料袋里的录音机', '定镜 · 2s', '特写'], ['沈砚的旧船票', '俯拍 · 2s', '特写'],
      ['两人隔着一步', '静止 · 4s', '双人'], ['“潮水迟到”', '近景 · 3s', '近景'],
    ],
  },
  s12: {
    name: '场 12 · 渡轮底舱', sub: '6 个镜头 · 预计 24 秒 · AI 生成的分镜草案',
    shots: [
      ['渡轮底舱', '缓慢推进 · 6s', '全景'], ['手电扫过铁柜', '横移 · 4s', '中景'],
      ['铁柜上的划痕', '定镜 · 2s', '特写'], ['林雾的眼神', '手持 · 3s', '近景'],
      ['两人对峙', '缓慢环绕 · 5s', '过肩'], ['录音机的红灯', '定镜 · 2s', '特写'],
    ],
  },
  s13: {
    name: '场 13 · 声音修复室', sub: '6 个镜头 · 预计 21 秒 · AI 生成的分镜草案',
    shots: [
      ['声音修复室', '缓慢横移 · 5s', '全景'], ['耳机与旋钮', '微距 · 3s', '特写'],
      ['磁带开始转动', '定镜 · 2s', '特写'], ['沈砚的肩膀', '背后近景 · 4s', '近景'],
      ['林雾站在门口', '浅景深 · 3s', '中景'], ['示波器的绿线', '定镜 · 2s', '特写'],
    ],
  },
  s14: {
    name: '场 14 · 沈砚家', sub: '6 个镜头 · 预计 18 秒 · AI 生成的分镜草案',
    shots: [
      ['客厅里的三样东西', '俯拍 · 4s', '全景'], ['皮箱铜扣开了又合', '特写 · 3s', '特写'],
      ['窗外的雨', '空镜 · 3s', '空镜'], ['沈砚坐在中间', '正面中景 · 4s', '中景'],
      ['林雾入画', '跟拍 · 3s', '中景'], ['灯忽然灭了', '黑场 · 1s', '黑场'],
    ],
  },
};

const AI_RESPONSES = [
  {
    key: 'continue',
    paragraphs: [
      '门外的男人没有再敲。他把伞收得很慢，伞骨刮过墙面，发出一种类似牙齿打颤的轻响。沈砚忽然想起，十年前那个雨夜，也有人这样站在门外。',
      '沈砚把门链又扣紧了一格。他没有问第二遍，只把目光落在男人的鞋尖上。那双鞋是干的——雨下了整整三个小时，鞋面却没有一点水痕。',
    ],
  },
  {
    key: 'atmosphere',
    paragraphs: [
      '雨声在楼道里被放大了。每一滴都像敲在一只空箱子上，先是闷响，随后是长长的回音。',
      '沈砚闻到一股潮湿的铁锈味，从门缝底下渗进来。他低头，看见门槛上有一道细细的水线，正缓慢地朝屋里爬。',
    ],
  },
  {
    key: 'dialogue',
    paragraphs: [
      '“你迟到了。”沈砚说。\n“船晚了。”男人回答。\n“十年前也晚了吗？”\n男人没有回答。皮箱的铜扣在他指间响了一声，像某种被压住的叹息。',
      '“我只问一次。”沈砚把门开到链子允许的最大幅度，“箱子里是什么？”\n“你妹妹没有寄出的信。”',
    ],
  },
  {
    key: 'foreshadow',
    paragraphs: [
      '男人把皮箱放在门槛外，没有进来。他弯腰时，大衣后摆掀起一角，露出腰间一枚旧船票的边角——日期是 2006 年 9 月 17 日。',
      '沈砚记住了那个日期。很多年后他才明白，那不是船票的日期，是白鸥号最后一次靠岸的日子。',
    ],
  },
];

const AI_RESPONSES_FERRY = [
  {
    paragraphs: [
      '老周没有立刻开船。他把船票翻到背面，那里有一行被水泡开的字：“别让她上岸。”',
      '他抬头时，女人已经站在驾驶室门口。她的鞋是干的，脚边的藤箱却在往下滴水。发动机的低鸣忽然停了。',
    ],
  },
  {
    paragraphs: [
      '“三年前，我把这张票送给一个人。”老周说，“她答应我，永远不坐这班船。”',
      '女人把藤箱放到长椅上，慢慢打开。里面没有行李，只有二十三张同样日期的船票。',
    ],
  },
];

const AI_RESPONSES_NEW = [
  {
    paragraphs: [
      '雾从海面漫上来时，灯塔的光刚好扫过第三圈。守塔人听见楼下有人敲门，三下，停一拍，又三下。',
      '他没有立刻下去。桌上那封没有署名的信，已经被他拆开又折好三次。信封上的潮气还没有干。',
    ],
  },
  {
    paragraphs: [
      '第一句话不必解释太多。让一个具体的动作先发生：有人把信推到桌子中央，然后退后一步，像是在等一个判决。',
      '读者会跟着这个动作进入场景。至于信里写了什么，可以留到下一个段落再揭晓。',
    ],
  },
];

const aiTextStore = new Map();
let aiMsgSeq = 0;

/* ============================================================
   工具
   ============================================================ */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function countWords(html) {
  const text = String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + latin;
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

const CN_NUMS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function numberToChinese(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return String(n);
  if (num < 10) return CN_NUMS[num];
  if (num < 20) return `十${num % 10 ? CN_NUMS[num % 10] : ''}`;
  if (num < 100) return `${CN_NUMS[Math.floor(num / 10)]}十${num % 10 ? CN_NUMS[num % 10] : ''}`;
  return String(num);
}

function ensureChapterValid() {
  const p = currentProject();
  if (!p || !p.chapters || !p.chapters.length) return;
  if (!p.chapters.some((c) => c.id === state.chapter)) {
    state.chapter = p.lastChapter || p.chapters[0].id;
  }
}

const CHAPTER_NOTES = {
  ch5: { text: '缺口的裁切方向朝内，说明动手的人站在档案柜内侧。这个细节留到第 8 章让沈砚回想。', tags: ['线索', '档案'], time: '16:40' },
  ch6: { text: '灯塔墙上的刻痕不是日期，是三道潮位线。林雾看见沈砚注意到它，却故意把灯调暗。', tags: ['林雾', '刻痕'], time: '17:05' },
  ch7: { text: '访客的伞留在门外。让“没有撑伞”成为第 14 章识破身份的伏笔。', tags: ['伏笔', '访客'], time: '17:12' },
  ch8: { text: '“十一点四十，不要上船”这行字要让读者以为是警告沈砚，其实是在警告十年前的沈鹭。', tags: ['时间线', '妹妹'], time: '17:20' },
  ch9: { text: '周隐第一次正面出场。不要让他发火，让他在敬茶时准确说出沈鹭的乳名。', tags: ['周隐', '对白'], time: '17:26' },
  f1: { text: '老周的钟停在十点四十一分。让这个时间在结尾再出现一次，但这次是女人腕表上的时间。', tags: ['时间', '反转'], time: '昨天' },
  f2: { text: '老周说“不认识”时，手在方向盘上敲了三下。这个动作要写得像习惯，而不是紧张。', tags: ['老周', '细节'], time: '昨天' },
};

const TEMPLATE_PRESETS = {
  novel: { premise: '一个替人写遗书的代笔人，收到了一封写给自己的遗书，落款日期是明天。', genre: '悬疑 · 文学', tone: '潮湿阴郁', length: '25 万字' },
  short: { premise: '末班渡轮靠岸前，摆渡人发现乘客名单上多了一个三年前就该死去的人。', genre: '现实主义', tone: '冷峻克制', length: '8 万字' },
  script: { premise: '一场发生在渡轮底舱的对峙：两个人都在找同一盘录音带，但谁都不肯先说自己在找什么。', genre: '犯罪 · 黑色电影', tone: '冷峻克制', length: '不限' },
  series: { premise: '一座港口小城，每隔十年就会有一艘船“准时”沉没，而港务局的档案里，所有事故都写着同一个值班员。', genre: '悬疑 · 文学', tone: '荒诞黑色', length: '25 万字' },
};

function currentProject() {
  return projects[state.project] || projects.fog;
}

function currentChapter() {
  const p = currentProject();
  if (!p.chapters) return null;
  return p.chapters.find((c) => c.id === state.chapter) || p.chapters[0];
}

function updateChapterWordMeta(chapter) {
  chapter.words = countWords(chapter.content || '');
  return chapter.words;
}

function hydrateAllWords() {
  Object.values(projects).forEach((p) => {
    if (p.chapters) p.chapters.forEach(updateChapterWordMeta);
  });
}

/* ============================================================
   Toast
   ============================================================ */

function toast(message, kind = 'ok') {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = `toast${kind === 'warn' ? ' toast--warn' : ''}`;
  el.innerHTML = `<svg class="icon"><use href="#${kind === 'warn' ? 'i-alert' : 'i-check'}"></use></svg><span>${escapeHtml(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  }, 2400);
}

/* ============================================================
   顶栏
   ============================================================ */

function renderTopbar() {
  const left = $('#topbarLeft');
  const tabs = $('#topbarTabs');
  const actions = $('#topbarActions');
  if (!left || !tabs || !actions) return;

  if (state.view === 'library') {
    const projectList = Object.values(projects);
    const wordTotal = projectList
      .filter((p) => p.type !== '电影剧本')
      .reduce((sum, p) => sum + (p.totalWords || 0), 0);
    left.innerHTML = `
      <div class="tb-crumb">
        <span class="tb-crumb__title">作品库</span>
        <span class="tb-crumb__sub">${projectList.length} 部作品 · ${(wordTotal / 10000).toFixed(1)} 万字</span>
      </div>`;
    tabs.innerHTML = '';
    actions.innerHTML = `
      <span class="tb-save"><i></i>云同步 · 刚刚</span>
      <div class="tb-divider"></div>
      <button class="avatar" type="button" data-action="account" title="马良">马</button>`;
    return;
  }

  if (state.view === 'screenplay') {
    const p = projects.echo;
    left.innerHTML = `
      <button class="tb-crumb__back" type="button" data-nav="library" title="返回作品库">
        <svg class="icon"><use href="#i-arrow-left"></use></svg>
      </button>
      <div class="tb-project">
        <div class="tb-cover cover--echo"></div>
        <div class="tb-project__info">
          <div class="tb-project__title">${escapeHtml(p.title)}<span class="tb-tag">${escapeHtml(p.type)}</span></div>
          <span class="tb-project__meta">${escapeHtml(p.genre)} · 第二稿</span>
        </div>
      </div>`;
    tabs.innerHTML = '';
    actions.innerHTML = `
      <span class="tb-words"><b>102</b> 页</span>
      <div class="tb-divider"></div>
      <button class="icon-btn tb-icon" type="button" data-action="export" title="导出 PDF">
        <svg class="icon"><use href="#i-download"></use></svg>
      </button>
      <button class="avatar" type="button" data-action="account" title="马良">马</button>`;
    return;
  }

  const p = currentProject();
  left.innerHTML = `
    <button class="tb-crumb__back" type="button" data-nav="library" title="返回作品库">
      <svg class="icon"><use href="#i-arrow-left"></use></svg>
    </button>
    <div class="tb-project">
      <div class="tb-cover cover--${p.cover}"></div>
      <div class="tb-project__info">
        <div class="tb-project__title">${escapeHtml(p.title)}<span class="tb-tag">${escapeHtml(p.type)}</span></div>
        <span class="tb-project__meta">${escapeHtml(p.genre)}</span>
      </div>
    </div>`;

  tabs.innerHTML = p.tabs
    .map((t) => `<button type="button" data-nav="${t.view}" class="${state.view === t.view ? 'is-active' : ''}">${t.label}</button>`)
    .join('');

  if (state.view === 'studio') {
    actions.innerHTML = `
      <span class="tb-words"><b>${formatNumber(p.totalWords)}</b> 字</span>
      <div class="tb-divider"></div>
      <button class="icon-btn tb-icon" type="button" data-action="export" title="导出">
        <svg class="icon"><use href="#i-download"></use></svg>
      </button>
      <button class="icon-btn tb-icon" type="button" data-action="toggleFocus" title="专注模式">
        <svg class="icon"><use href="#i-focus"></use></svg>
      </button>
      <button class="avatar" type="button" data-action="account" title="马良">马</button>`;
  } else if (state.view === 'outline') {
    actions.innerHTML = `
      <button class="btn btn--ghost btn--sm" type="button" data-action="exportOutline">
        <svg class="icon"><use href="#i-download"></use></svg> 导出大纲
      </button>
      <button class="avatar" type="button" data-action="account" title="马良">马</button>`;
  } else if (state.view === 'codex') {
    actions.innerHTML = `
      <button class="btn btn--ghost btn--sm" type="button" data-action="exportCodex">
        <svg class="icon"><use href="#i-download"></use></svg> 导出设定集
      </button>
      <button class="avatar" type="button" data-action="account" title="马良">马</button>`;
  }
}


/* ============================================================
   外观：主题 / 强调色 / 阅读
   ============================================================ */
function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 212, g: 99, b: 76 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function mixHex(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const t = Math.max(0, Math.min(1, amount));
  const toHex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(a.r + (b.r - a.r) * t)}${toHex(a.g + (b.g - a.g) * t)}${toHex(a.b + (b.b - a.b) * t)}`;
}

function resolveAccent() {
  const isPaper = appearance.theme === 'paper';
  if (appearance.customAccent) {
    const base = isPaper ? mixHex(appearance.customAccent, '#3a2418', 0.18) : appearance.customAccent;
    return {
      name: '自定义',
      base,
      hi: isPaper ? mixHex(base, '#000000', 0.1) : mixHex(base, '#ffffff', 0.16),
      deep: mixHex(base, '#000000', isPaper ? 0.2 : 0.16),
      rgb: hexToRgb(base),
    };
  }
  const preset = ACCENT_PRESETS[appearance.accent] || ACCENT_PRESETS.cinnabar;
  return {
    name: preset.name,
    base: isPaper ? preset.light : preset.dark,
    hi: isPaper ? preset.lightHi : preset.hi,
    deep: isPaper ? preset.lightDeep : preset.deep,
    rgb: hexToRgb(isPaper ? preset.light : preset.dark),
  };
}

function applyAppearance(persist = true) {
  if (!THEME_META[appearance.theme]) appearance.theme = 'ink';
  const theme = THEME_META[appearance.theme];
  const accent = resolveAccent();
  const root = document.documentElement;
  root.setAttribute('data-theme', appearance.theme);
  root.style.setProperty('--accent', accent.base);
  root.style.setProperty('--accent-hi', accent.hi);
  root.style.setProperty('--accent-deep', accent.deep);
  root.style.setProperty('--accent-rgb', `${accent.rgb.r}, ${accent.rgb.g}, ${accent.rgb.b}`);
  root.style.setProperty('--accent-soft', `rgba(${accent.rgb.r}, ${accent.rgb.g}, ${accent.rgb.b}, ${appearance.theme === 'paper' ? 0.09 : 0.11})`);
  root.style.setProperty('--accent-line', `rgba(${accent.rgb.r}, ${accent.rgb.g}, ${accent.rgb.b}, ${appearance.theme === 'paper' ? 0.26 : 0.3})`);
  root.style.setProperty('--editor-size', `${appearance.editorSize}px`);
  root.classList.toggle('reduce-motion', Boolean(appearance.reduceMotion));
  updateAppearanceUI(theme, accent);
  if (persist) writeStorage(STORAGE_KEYS.appearance, appearance);
}

function updateAppearanceUI(theme, accent) {
  $$('.theme-card').forEach((card) => {
    card.classList.toggle('is-active', card.dataset.themeChoice === appearance.theme);
  });
  const isPaper = appearance.theme === 'paper';
  $$('.accent-swatch').forEach((swatch) => {
    const active = !appearance.customAccent && swatch.dataset.accentChoice === appearance.accent;
    swatch.classList.toggle('is-active', active);
    const preset = ACCENT_PRESETS[swatch.dataset.accentChoice];
    if (preset) {
      const hex = isPaper ? preset.light : preset.dark;
      swatch.style.setProperty('--swatch', hex);
      const label = swatch.querySelector('em');
      if (label) label.textContent = hex.toUpperCase();
    }
  });
  const custom = $('#customAccent');
  if (custom) custom.value = appearance.customAccent || (ACCENT_PRESETS[appearance.accent] || ACCENT_PRESETS.cinnabar).dark;
  const customHex = $('#customAccentHex');
  if (customHex) customHex.textContent = (appearance.customAccent || accent.base).toUpperCase();
  const sizeLabel = $('#editorSizeLabel');
  if (sizeLabel) sizeLabel.textContent = `${appearance.editorSize.toFixed(1)} px`;
  const range = $('#editorSizeRange');
  if (range) range.value = appearance.editorSize;
  const motion = $('#reduceMotionSwitch');
  if (motion) {
    motion.classList.toggle('is-on', Boolean(appearance.reduceMotion));
    motion.setAttribute('aria-checked', String(Boolean(appearance.reduceMotion)));
  }
  const themeName = $('#previewThemeName');
  if (themeName) themeName.textContent = theme ? theme.name : '墨夜';
  const accentName = $('#previewAccentName');
  if (accentName) accentName.textContent = appearance.customAccent ? '自定义' : (accent ? accent.name : '朱砂');
}

function initAppearance() {
  const saved = readStorage(STORAGE_KEYS.appearance, null);
  if (saved && typeof saved === 'object') {
    appearance = { ...DEFAULT_APPEARANCE, ...saved };
  }
  if (!THEME_META[appearance.theme]) appearance.theme = 'ink';
  if (!ACCENT_PRESETS[appearance.accent] && !appearance.customAccent) appearance.accent = 'cinnabar';
  appearance.editorSize = Number(appearance.editorSize) || 17.5;
  applyAppearance(false);
}

function resetAppearanceSettings() {
  appearance = { ...DEFAULT_APPEARANCE };
  applyAppearance(true);
  toast('已恢复默认外观：墨夜 · 朱砂');
}

/* ============================================================
   设置中心打开 / 关闭
   ============================================================ */
const SETTINGS_META = {
  appearance: { title: '外观', subtitle: '主题、强调色与正文阅读体验，修改会立即生效。' },
  models: { title: '模型与供应商', subtitle: '连接不同厂商、管理模型与生成参数。配置会保存在本地浏览器。' },
  writing: { title: '写作偏好', subtitle: '视角、文风与 AI 续写习惯，会让每次共笔更接近你的写作方式。' },
  shortcuts: { title: '快捷键', subtitle: '写作时尽量不离开键盘。' },
  data: { title: '数据与隐私', subtitle: '外观偏好、供应商配置与作品数据分别存放在哪里。' },
};

function openSettings(tab = 'appearance') {
  setSettingsTab(tab);
  const overlay = $('#settingsOverlay');
  if (overlay) overlay.hidden = false;
  closeAllPopovers();
  updateStorageUsage();
  setTimeout(() => {
    const active = $('.settings-menu button.is-active');
    if (active) active.focus({ preventScroll: true });
  }, 60);
}

function closeSettings() {
  const overlay = $('#settingsOverlay');
  if (overlay) overlay.hidden = true;
  closeProviderPanel();
  closeProviderCatalog();
}

function setSettingsTab(tab) {
  if (!SETTINGS_META[tab]) tab = 'appearance';
  settingsState.tab = tab;
  $$('#settingsMenu button').forEach((b) => b.classList.toggle('is-active', b.dataset.settingsTab === tab));
  $$('.settings-pane').forEach((pane) => {
    const active = pane.dataset.settingsPane === tab;
    pane.classList.toggle('is-active', active);
    pane.hidden = !active;
  });
  const meta = SETTINGS_META[tab];
  $('#settingsTitle').textContent = meta.title;
  $('#settingsSubtitle').textContent = meta.subtitle;
  const scroller = $('#settingsScroll');
  if (scroller) scroller.scrollTop = 0;
  if (tab === 'models') {
    renderProviders();
    renderModelPopover();
  }
  if (tab === 'writing') syncWritingPrefs();
  if (tab === 'data') updateStorageUsage();
}


/* ============================================================
   模型供应商
   ============================================================ */
function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function initProviders() {
  const saved = readStorage(STORAGE_KEYS.providers, null);
  if (saved && Array.isArray(saved.providers) && saved.providers.length) {
    providers = saved.providers;
    defaultModel = saved.defaultModel || defaultModel;
    fallbackModel = saved.fallbackModel || fallbackModel;
    if (saved.generation && typeof saved.generation === 'object') generationSettings = { ...generationSettings, ...saved.generation };
  } else {
    providers = cloneData(DEFAULT_PROVIDERS);
  }
  providers = providers.map((p) => ({
    ...p,
    models: Array.isArray(p.models) ? p.models : [],
    enabledModels: Array.isArray(p.enabledModels) ? p.enabledModels.filter((id) => p.models.some((m) => m.id === id)) : [],
  }));
  normalizeModelSelection();
  renderProviders();
  renderModelPopover();
  updateModelPill();
  syncGenerationUI();
}

function saveProviderSettings() {
  writeStorage(STORAGE_KEYS.providers, {
    providers,
    defaultModel,
    fallbackModel,
    generation: generationSettings,
  });
}

function enabledModelEntries() {
  const entries = [];
  providers.forEach((p) => {
    if (!p.configured || !p.enabled) return;
    p.enabledModels.forEach((modelId) => {
      const model = p.models.find((m) => m.id === modelId);
      if (model) entries.push({ provider: p, model, key: `${p.id}::${model.id}` });
    });
  });
  return entries;
}

function modelEntryByKey(key) {
  return enabledModelEntries().find((e) => e.key === key) || null;
}

function currentModelEntry() {
  return enabledModelEntries().find(
    (e) => e.provider.id === defaultModel.providerId && e.model.id === defaultModel.modelId
  ) || enabledModelEntries()[0] || null;
}

function currentModelLabel() {
  const entry = currentModelEntry();
  return entry ? entry.model.name : '未配置模型';
}

function normalizeModelSelection() {
  const entries = enabledModelEntries();
  if (!entries.length) {
    defaultModel = { providerId: '', modelId: '' };
    fallbackModel = null;
    return;
  }
  if (!entries.some((e) => e.provider.id === defaultModel.providerId && e.model.id === defaultModel.modelId)) {
    defaultModel = { providerId: entries[0].provider.id, modelId: entries[0].model.id };
  }
  if (fallbackModel && !entries.some((e) => e.provider.id === fallbackModel.providerId && e.model.id === fallbackModel.modelId)) {
    fallbackModel = null;
  }
  if (!fallbackModel && entries.length > 1) {
    const candidate = entries.find((e) => e.provider.id !== defaultModel.providerId) || entries[1];
    fallbackModel = { providerId: candidate.provider.id, modelId: candidate.model.id };
  }
}

function providerHost(url) {
  try {
    return new URL(url).host;
  } catch (e) {
    return url || '未设置 Base URL';
  }
}

function renderProviders() {
  const grid = $('#providerGrid');
  if (!grid) return;
  const connected = providers.filter((p) => p.configured).length;
  const entries = enabledModelEntries();
  const connectedEl = $('#providerConnectedCount');
  if (connectedEl) connectedEl.textContent = String(connected);
  const availableEl = $('#availableModelCount');
  if (availableEl) availableEl.textContent = String(entries.length);
  const configuredEl = $('#providerConfiguredCount');
  if (configuredEl) configuredEl.textContent = `${connected} / ${providers.length}`;
  const navBadge = $('.settings-menu__badge');
  if (navBadge) navBadge.textContent = String(providers.length);

  const current = currentModelEntry();
  if (current) {
    $('#defaultModelName').textContent = current.model.name;
    $('#defaultModelVendor').textContent = current.provider.name;
    const dot = $('#defaultModelDot');
    if (dot) dot.style.background = current.provider.brand;
  } else {
    $('#defaultModelName').textContent = '未配置模型';
    $('#defaultModelVendor').textContent = '请连接供应商';
  }

  grid.innerHTML = providers.map((p) => {
    const isConnected = Boolean(p.configured && p.key);
    const isDefault = current && current.provider.id === p.id;
    const enabledNames = p.enabledModels
      .map((id) => (p.models.find((m) => m.id === id) || {}).name)
      .filter(Boolean);
    const status = !p.configured ? '未配置' : (p.enabled ? '已连接' : '已停用');
    const statusCls = p.configured && p.enabled ? 'is-connected' : '';
    const offCls = p.enabled ? '' : ' is-off';
    return `
      <article class="provider-card ${statusCls}${offCls}" data-provider-card="${escapeHtml(p.id)}" data-action="configureProvider" data-provider-id="${escapeHtml(p.id)}" role="button" tabindex="0">
        <div class="provider-card__head">
          <span class="provider-logo" style="--brand:${escapeHtml(p.brand)}">${escapeHtml(p.mark)}</span>
          <div>
            <h4>${escapeHtml(p.name)}<span>${escapeHtml(p.family)}</span></h4>
            <p>${escapeHtml(providerHost(p.baseUrl))} · ${p.models.length} 个模型</p>
          </div>
          <button class="switch${p.configured && p.enabled ? ' is-on' : ''}" type="button" role="switch" aria-checked="${p.configured && p.enabled}" data-action="toggleProvider" data-provider-id="${escapeHtml(p.id)}"><i></i></button>
        </div>
        <div class="provider-card__status"><i></i>${status}<em>${enabledNames.length ? `${enabledNames.length} 个已启用` : '未启用模型'}</em></div>
        <div class="provider-card__models">
          ${enabledNames.length
            ? enabledNames.slice(0, 3).map((name) => `<span>${escapeHtml(name)}</span>`).join('') + (enabledNames.length > 3 ? `<span>+${enabledNames.length - 3}</span>` : '')
            : '<span class="empty">配置 API Key 后选择模型</span>'}
        </div>
        <div class="provider-card__foot">
          <span>${isDefault && current ? `默认 · ${escapeHtml(current.model.name)}` : (isConnected ? escapeHtml(providerHost(p.baseUrl)) : '尚未连接')}</span>
          <button type="button" data-action="configureProvider" data-provider-id="${escapeHtml(p.id)}">${isConnected ? '配置' : '连接'}</button>
        </div>
      </article>`;
  }).join('');

  populateModelSelects(entries);
}

function populateModelSelects(entries) {
  const defaultSelect = $('#defaultModelSelect');
  const fallbackSelect = $('#fallbackModelSelect');
  if (!defaultSelect || !fallbackSelect) return;
  if (!entries.length) {
    defaultSelect.innerHTML = '<option value="">暂无可用模型</option>';
    fallbackSelect.innerHTML = '<option value="">不启用</option>';
    return;
  }
  const groups = providers
    .filter((p) => p.configured && p.enabled)
    .map((p) => {
      const models = p.enabledModels
        .map((id) => p.models.find((m) => m.id === id))
        .filter(Boolean);
      if (!models.length) return '';
      return `<optgroup label="${escapeHtml(p.name)}">${models
        .map((m) => `<option value="${escapeHtml(`${p.id}::${m.id}`)}">${escapeHtml(m.name)} · ${escapeHtml(m.ctx)}</option>`)
        .join('')}</optgroup>`;
    })
    .join('');
  defaultSelect.innerHTML = groups;
  fallbackSelect.innerHTML = '<option value="">不启用</option>' + groups;
  const current = currentModelEntry();
  if (current) defaultSelect.value = `${current.provider.id}::${current.model.id}`;
  if (fallbackModel && entries.some((e) => e.provider.id === fallbackModel.providerId && e.model.id === fallbackModel.modelId)) {
    fallbackSelect.value = `${fallbackModel.providerId}::${fallbackModel.modelId}`;
  } else {
    fallbackSelect.value = '';
  }
}

function syncGenerationUI() {
  const temp = $('#temperatureRange');
  const tempLabel = $('#temperatureValue');
  if (temp) temp.value = generationSettings.temperature;
  if (tempLabel) tempLabel.textContent = Number(generationSettings.temperature).toFixed(1);
  const streaming = $('#streamingSwitch');
  if (streaming) {
    streaming.classList.toggle('is-on', Boolean(generationSettings.streaming));
    streaming.setAttribute('aria-checked', String(Boolean(generationSettings.streaming)));
  }
}

function updateModelPill() {
  const entry = currentModelEntry();
  const pill = $('.model-pill');
  if (pill) {
    pill.innerHTML = `${escapeHtml(entry ? entry.model.name : '选择模型')} <svg class="icon"><use href="#i-chevron-down"></use></svg>`;
  }
}

function renderModelPopover() {
  const el = $('#modelPopover');
  if (!el) return;
  const entries = enabledModelEntries();
  const head = `<div class="popover__head">选择模型 <span>${entries.length} 个可用</span></div>`;
  if (!entries.length) {
    el.innerHTML = `${head}<div class="popover__empty">还没有已连接的模型<br>先去设置里连接一个供应商</div><div class="popover__foot"><button class="text-btn" type="button" data-action="manageProviders">管理供应商 <svg class="icon"><use href="#i-arrow-right"></use></svg></button></div>`;
    return;
  }
  el.innerHTML = head + entries
    .map((e) => `
      <button class="popover__item${currentModelEntry() && currentModelEntry().key === e.key ? ' is-active' : ''}" type="button" data-model-key="${escapeHtml(e.key)}">
        <span><strong>${escapeHtml(e.model.name)}</strong><em>${escapeHtml(e.provider.name)} · ${escapeHtml(e.model.ctx)} 上下文</em></span>
        <svg class="icon"><use href="#i-check"></use></svg>
      </button>`)
    .join('') + `<div class="popover__foot"><button class="text-btn" type="button" data-action="manageProviders">管理供应商 <svg class="icon"><use href="#i-arrow-right"></use></svg></button></div>`;
}

function setDefaultModelByKey(key) {
  const entry = modelEntryByKey(key);
  if (!entry) return;
  defaultModel = { providerId: entry.provider.id, modelId: entry.model.id };
  normalizeModelSelection();
  saveProviderSettings();
  renderProviders();
  renderModelPopover();
  updateModelPill();
  const status = $('[data-action="modelMenu"]');
  if (status) status.blur();
  toast(`已切换默认模型：${entry.model.name}`);
}

function toggleProvider(providerId) {
  const p = providers.find((x) => x.id === providerId);
  if (!p) return;
  if (!p.configured) {
    openProviderPanel(providerId);
    return;
  }
  p.enabled = !p.enabled;
  if (p.enabled && !p.enabledModels.length) {
    p.enabledModels = p.models.length ? [p.models[0].id] : [];
  }
  normalizeModelSelection();
  saveProviderSettings();
  renderProviders();
  renderModelPopover();
  updateModelPill();
  toast(`${p.name} ${p.enabled ? '已启用' : '已停用'}`);
}

/* ---------- 供应商配置 ---------- */
function openProviderPanel(providerId) {
  const p = providers.find((x) => x.id === providerId);
  if (!p) return;
  settingsState.editingProvider = providerId;
  settingsState.connection = p.configured ? 'ok' : 'idle';
  settingsState.draft = {
    enabled: Boolean(p.enabled),
    enabledModels: [...p.enabledModels],
    defaultModel: p.defaultModel || (p.models[0] ? p.models[0].id : ''),
    key: p.key || '',
    baseUrl: p.baseUrl || '',
    defaultChanged: false,
  };
  $('#providerLogo').textContent = p.mark;
  $('#providerLogo').style.setProperty('--brand', p.brand);
  $('#providerName').textContent = p.name;
  $('#providerKind').textContent = `${p.family} · ${p.id === 'ollama' || p.id === 'vllm' || p.id === 'lmstudio' ? '本地推理' : '云端 API'}`;
  $('#providerEndpointLabel').textContent = providerHost(p.baseUrl);
  $('#providerKey').value = p.key || '';
  $('#providerKey').type = 'password';
  $('#providerBase').value = p.baseUrl || '';
  const enabledSwitch = $('#providerEnabledSwitch');
  const switchOn = Boolean(p.enabled) || !p.configured;
  enabledSwitch.classList.toggle('is-on', switchOn);
  enabledSwitch.setAttribute('aria-checked', String(switchOn));
  renderProviderModelList();
  updateProviderStatusUI(p.configured ? 'ok' : 'idle');
  $('#providerLayer').hidden = false;
  setTimeout(() => $('#providerKey')?.focus(), 60);
}

function closeProviderPanel() {
  const layer = $('#providerLayer');
  if (layer) layer.hidden = true;
  settingsState.editingProvider = null;
  settingsState.draft = null;
}

function renderProviderModelList() {
  const list = $('#providerModelList');
  if (!list) return;
  const p = providers.find((x) => x.id === settingsState.editingProvider);
  if (!p || !settingsState.draft) return;
  const draft = settingsState.draft;
  list.innerHTML = p.models.map((m) => {
    const enabled = draft.enabledModels.includes(m.id);
    return `
      <label class="provider-model-item${enabled ? ' is-enabled' : ''}">
        <input type="checkbox" data-provider-model="${escapeHtml(m.id)}" ${enabled ? 'checked' : ''}>
        <span class="provider-model-item__body"><strong>${escapeHtml(m.name)}</strong><span>${escapeHtml(m.ctx)} 上下文</span></span>
        <span class="provider-model-item__tags">${m.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</span>
        <button class="model-star${draft.defaultModel === m.id ? ' is-default' : ''}" type="button" data-action="providerModelDefault" data-model-id="${escapeHtml(m.id)}" title="设为默认模型"><svg class="icon"><use href="#i-star"></use></svg></button>
      </label>`;
  }).join('') || '<div class="catalog-empty">这个供应商还没有模型，保存后可在正式版自动获取。</div>';
}

function updateProviderStatusUI(status) {
  const badge = $('#providerStatusBadge');
  const conn = $('#connectionStatus');
  if (badge) {
    badge.classList.toggle('is-off', status !== 'ok');
    badge.innerHTML = `<i></i>${status === 'ok' ? '已连接' : (status === 'loading' ? '检查中' : (status === 'error' ? '连接失败' : '未配置'))}`;
  }
  if (conn) {
    conn.className = 'connection-status' + (status === 'ok' ? ' is-ok' : status === 'loading' ? ' is-loading' : status === 'error' ? ' is-error' : '');
    conn.innerHTML = `<i></i>${status === 'ok' ? '连接正常 · 刚刚' : status === 'loading' ? '检查中…' : status === 'error' ? '连接失败 · 请检查 Key' : '未测试'}`;
  }
}

function testProviderConnection() {
  const key = $('#providerKey').value.trim();
  if (!key) {
    updateProviderStatusUI('error');
    toast('请先填写 API Key，再检查连接', 'warn');
    return;
  }
  const btn = $('[data-action="testProviderConnection"]');
  if (btn) {
    btn.disabled = true;
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = '<svg class="icon"><use href="#i-refresh"></use></svg> 检查中…';
  }
  updateProviderStatusUI('loading');
  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.label || '检查连接';
    }
    const failed = /bad|invalid/i.test(key);
    updateProviderStatusUI(failed ? 'error' : 'ok');
    toast(failed ? '连接失败：API Key 无效（演示）' : '连接成功，模型列表已就绪', failed ? 'warn' : 'ok');
  }, 1000);
}

function saveProviderPanel() {
  const p = providers.find((x) => x.id === settingsState.editingProvider);
  if (!p || !settingsState.draft) return;
  const key = $('#providerKey').value.trim();
  const baseUrl = $('#providerBase').value.trim();
  const enabled = $('#providerEnabledSwitch').classList.contains('is-on');
  const draft = settingsState.draft;
  if (enabled && key && !draft.enabledModels.length) {
    toast('至少启用一个模型，才能保存为可用供应商', 'warn');
    return;
  }
  p.key = key;
  p.baseUrl = baseUrl || p.baseUrl;
  p.configured = Boolean(key);
  p.enabled = Boolean(key) && enabled;
  p.enabledModels = p.configured ? [...draft.enabledModels] : [];
  p.defaultModel = draft.defaultModel || (p.models[0] ? p.models[0].id : '');
  if (p.configured && p.enabled && p.defaultModel && !p.enabledModels.includes(p.defaultModel)) {
    p.enabledModels.push(p.defaultModel);
  }
  if (!p.configured) p.enabled = false;
  if (p.configured && p.enabled && draft.defaultChanged && draft.defaultModel) {
    defaultModel = { providerId: p.id, modelId: draft.defaultModel };
  }
  normalizeModelSelection();
  saveProviderSettings();
  renderProviders();
  renderModelPopover();
  updateModelPill();
  closeProviderPanel();
  toast(`${p.name} 配置已保存`);
}

function fetchProviderModels() {
  const p = providers.find((x) => x.id === settingsState.editingProvider);
  if (!p) return;
  if (!$('#providerKey').value.trim()) {
    toast('填写 API Key 后才能获取模型', 'warn');
    return;
  }
  renderProviderModelList();
  toast(`已同步 ${p.models.length} 个模型（演示）`);
}

/* ---------- 供应商目录 ---------- */
function openProviderCatalog() {
  renderProviderCatalog();
  const layer = $('#providerCatalogLayer');
  if (layer) layer.hidden = false;
  setTimeout(() => $('#providerCatalogSearch')?.focus(), 60);
}

function closeProviderCatalog() {
  const layer = $('#providerCatalogLayer');
  if (layer) layer.hidden = true;
  settingsState.catalogQuery = '';
  const search = $('#providerCatalogSearch');
  if (search) search.value = '';
}

function renderProviderCatalog() {
  const grid = $('#providerCatalogGrid');
  if (!grid) return;
  const q = settingsState.catalogQuery.trim().toLowerCase();
  const available = EXTRA_PROVIDERS.filter((p) => !providers.some((x) => x.id === p.id));
  const filtered = available.filter((p) => !q || p.name.toLowerCase().includes(q) || p.family.toLowerCase().includes(q));
  if (!filtered.length) {
    grid.innerHTML = '<div class="catalog-empty">没有更多可添加的预设供应商。你仍可以使用下方的「自定义 OpenAI 兼容接口」。</div>';
    return;
  }
  grid.innerHTML = filtered.map((p) => `
    <button class="catalog-item" type="button" data-action="addCatalogProvider" data-provider-id="${escapeHtml(p.id)}">
      <span class="provider-logo" style="--brand:${escapeHtml(p.brand)}">${escapeHtml(p.mark)}</span>
      <div><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.family)} · ${p.models.length} 个模型 · ${escapeHtml(providerHost(p.baseUrl))}</span></div>
      <svg class="icon"><use href="#i-plus"></use></svg>
    </button>`).join('');
}

function addCatalogProvider(providerId) {
  const catalog = EXTRA_PROVIDERS.find((p) => p.id === providerId);
  if (!catalog) return;
  if (providers.some((p) => p.id === providerId)) {
    toast('这个供应商已经在列表里了');
    return;
  }
  const copy = cloneData(catalog);
  providers.push(copy);
  saveProviderSettings();
  renderProviders();
  closeProviderCatalog();
  openProviderPanel(copy.id);
  toast(`已添加 ${copy.name}，填写 Key 后即可使用`);
}

function addCustomProvider() {
  const id = `custom-${Date.now()}`;
  const custom = {
    id,
    name: '自定义供应商',
    family: '自定义',
    mark: '＋',
    brand: '#9a8fc4',
    baseUrl: 'https://api.example.com/v1',
    configured: false,
    enabled: false,
    key: '',
    models: [{ id: 'custom-model', name: 'custom-model', ctx: '自定义', tags: ['OpenAI 兼容'] }],
    enabledModels: [],
    defaultModel: 'custom-model',
  };
  providers.push(custom);
  saveProviderSettings();
  renderProviders();
  closeProviderCatalog();
  openProviderPanel(id);
  toast('已创建自定义供应商，请填写 Base URL 与 Key');
}

/* ============================================================
   写作偏好 / 本地数据
   ============================================================ */
function initPrefs() {
  const saved = readStorage(STORAGE_KEYS.prefs, null);
  if (saved && typeof saved === 'object') settingsPrefs = { ...DEFAULT_PREFS, ...saved };
  syncWritingPrefs();
}

function savePrefs() {
  writeStorage(STORAGE_KEYS.prefs, settingsPrefs);
}

function syncWritingPrefs() {
  const pov = $('#prefPov');
  if (pov) pov.value = settingsPrefs.pov;
  const genre = $('#prefGenre');
  if (genre) genre.value = settingsPrefs.genre;
  const length = $('#prefAiLength');
  if (length) length.value = settingsPrefs.aiLength;
  const auto = $('#prefAutoSave');
  if (auto) {
    auto.classList.toggle('is-on', Boolean(settingsPrefs.autoSave));
    auto.setAttribute('aria-checked', String(Boolean(settingsPrefs.autoSave)));
  }
  $$('#stylePicker button').forEach((b) => b.classList.toggle('is-active', b.textContent.trim() === settingsPrefs.style));
}

function updateStorageUsage() {
  let bytes = 0;
  try {
    Object.keys(localStorage).forEach((key) => {
      bytes += (localStorage.getItem(key) || '').length * 2;
    });
  } catch (e) {
    bytes = 0;
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  const usage = $('#storageUsage');
  if (usage) usage.textContent = `${kb} KB`;
  const bar = $('#storageBar');
  if (bar) bar.style.width = `${Math.min(100, Math.max(4, (kb / 512) * 100))}%`;
}

function exportSettingsFile() {
  const payload = {
    exportedAt: new Date().toISOString(),
    appearance,
    prefs: settingsPrefs,
    generation: generationSettings,
    defaultModel,
    fallbackModel,
    providers: providers.map((p) => ({ ...p, key: p.key ? '***（已隐藏）' : '' })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'private-writer-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('设置已导出（密钥已隐藏）');
}

function clearLocalSettings() {
  const ok = window.confirm('清除本机保存的外观、供应商与写作偏好？作品演示内容不会被删除。');
  if (!ok) return;
  Object.values(STORAGE_KEYS).forEach((key) => {
    try { localStorage.removeItem(key); } catch (e) {}
  });
  appearance = { ...DEFAULT_APPEARANCE };
  settingsPrefs = { ...DEFAULT_PREFS };
  providers = cloneData(DEFAULT_PROVIDERS);
  defaultModel = { providerId: 'deepseek', modelId: 'deepseek-chat' };
  fallbackModel = { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' };
  generationSettings = { temperature: 0.8, streaming: true };
  applyAppearance(false);
  syncWritingPrefs();
  renderProviders();
  renderModelPopover();
  updateModelPill();
  updateStorageUsage();
  toast('已清除本地偏好，恢复默认配置');
}

/* ============================================================
   视图切换
   ============================================================ */

function setView(view) {
  if (state.view === 'studio' && $('#editor')) syncEditor();

  const previousProject = state.project;
  const projectView = ['studio', 'outline', 'codex', 'screenplay'].includes(state.view);

  // 短篇 / 剧本在原型阶段还没有独立的大纲与设定数据：
  // 不静默切换项目，明确告诉作者当前能力边界。
  if ((view === 'outline' || view === 'codex') && state.project !== 'fog' && projectView) {
    const label = view === 'outline' ? '大纲' : '设定';
    toast(`《${currentProject().title}》暂未启用${label}视图（原型演示）`, 'warn');
    return;
  }

  if (view === 'studio' && state.project === 'echo') state.project = 'fog';
  if ((view === 'outline' || view === 'codex') && state.project !== 'fog') state.project = 'fog';
  if (view === 'screenplay') state.project = 'echo';

  if (state.project !== previousProject) {
    ensureChapterValid();
    resetAIPanelForProject(currentProject());
  } else {
    ensureChapterValid();
  }

  state.view = view;
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
  $$('.rail-btn[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === view));

  const panel = $('#panel');
  panel.hidden = view === 'library';
  $$('.panel-view').forEach((p) => {
    p.hidden = p.dataset.panel !== view;
  });

  if (view !== 'library') renderStudioPanel();
  if (view === 'studio') renderChapter();
  if (view === 'screenplay') {
    renderSceneTree();
    renderScene(state.scriptScene);
    setScriptMode(state.scriptMode, false);
  }
  renderTopbar();
  closeAllPopovers();
  const viewEl = $(`.view[data-view="${view}"]`);
  if (viewEl) viewEl.scrollTop = 0;
}

function openProject(id) {
  if (id === 'echo') {
    state.project = 'echo';
    state.scriptScene = 's12';
    setView('screenplay');
    return;
  }
  state.project = id;
  const p = projects[id];
  state.chapter = p.lastChapter || p.chapters[0].id;
  state.ghostAccepted = false;
  resetAIPanelForProject(p);
  setView('studio');
}

function addProjectCard(project) {
  const grid = $('#projectGrid');
  if (!grid) return;
  const filterMap = { novel: 'novel', short: 'short', script: 'script', series: 'script' };
  const card = document.createElement('article');
  card.className = 'project-card';
  card.dataset.project = project.id;
  card.dataset.filter = filterMap[project.wizardType] || 'novel';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `打开${project.title}`);
  card.innerHTML = `
    <div class="cover cover--${project.cover} cover--card"><span class="cover__mark">${escapeHtml(project.mark)}</span></div>
    <div class="project-card__body">
      <div class="project-card__top"><h3>${escapeHtml(project.title)}</h3><span class="tag tag--live">草稿</span></div>
      <p class="project-card__desc">${escapeHtml(project.desc)}</p>
      <div class="project-card__meta"><span>${escapeHtml(project.type)}</span><i></i><span>0 字</span><i></i><span>刚刚</span></div>
      <div class="project-card__progress"><div class="pbar"><i style="width:2%"></i></div><span>0%</span></div>
    </div>`;
  const newCard = grid.querySelector('.project-card--new');
  grid.insertBefore(card, newCard);
  const countLabel = $('#projectCountLabel');
  if (countLabel) countLabel.textContent = String(Object.keys(projects).length);
}

function createProjectFromWizard() {
  const typeMeta = {
    novel: { label: '长篇小说', cover: 'fog', filter: 'novel' },
    short: { label: '短篇小说', cover: 'ferry', filter: 'short' },
    script: { label: '电影剧本', cover: 'echo', filter: 'script' },
    series: { label: '剧集大纲', cover: 'echo', filter: 'script' },
  };
  const meta = typeMeta[state.wizardType] || typeMeta.novel;
  const id = `wizard-${Date.now()}`;
  const premise = $('#newPremise').value.trim() || '从一个还没有名字的念头开始。';
  const title = state.wizardTitle || '未命名作品';
  const project = {
    id,
    title,
    mark: title.charAt(0) || '新',
    cover: meta.cover,
    wizardType: state.wizardType,
    type: meta.label,
    genre: $('#newGenre').value || '新作品',
    desc: premise.length > 48 ? `${premise.slice(0, 48)}…` : premise,
    totalWords: 0,
    goalWords: 250000,
    lastChapter: 'w1',
    written: 1,
    totalChapters: 1,
    nextChapterNo: 2,
    tabs: [{ view: 'studio', label: '正文' }],
    aiWelcome: `《${title}》刚刚开始。你可以直接写第一段，或者让我根据刚才的方案起个头。`,
    memory: ['第一章草稿', '故事方案', '主要人物'],
    chapters: [
      { id: 'w1', vol: '第一卷', no: '第一章', title: '未命名章节', status: '草稿', content: '' },
    ],
  };
  projects[id] = project;
  addProjectCard(project);
  const allFilter = $('#libFilters [data-filter="all"]');
  if (allFilter) {
    $$('#libFilters button').forEach((b) => b.classList.toggle('is-active', b === allFilter));
  }
  const search = $('#libSearch');
  if (search) search.value = '';
  filterLibraryProjects();
  return project;
}

function renderStudioPanel() {
  const p = currentProject();
  const panel = $('[data-panel="studio"]');
  if (!panel || !p.chapters) return;
  const mini = $('.mini-cover', panel);
  if (mini) {
    mini.className = `mini-cover cover--${p.cover}`;
    const span = $('span', mini);
    if (span) span.textContent = p.mark;
  }
  $('#panelProjectTitle').textContent = p.title;
  $('#panelProjectMeta').textContent = `${p.genre} · ${p.type}`;
  const done = p.written != null ? p.written : p.chapters.filter((c) => !c.draft).length;
  const total = p.totalChapters || p.chapters.length;
  $('#chapterCount').textContent = `${done} / ${total} 章`;
  renderChapterTree();
}

function renderChapterTree() {
  const tree = $('#chapterTree');
  if (!tree) return;
  const p = currentProject();
  if (!p.chapters) {
    tree.innerHTML = '';
    return;
  }
  let html = '';
  let lastVol = '';
  p.chapters.forEach((ch) => {
    if (ch.vol !== lastVol) {
      lastVol = ch.vol;
      const volCount = p.chapters.filter((c) => c.vol === ch.vol).length;
      html += `<div class="tree-volume"><svg class="icon"><use href="#i-book"></use></svg>${escapeHtml(ch.vol)}<em>${volCount} 章</em></div>`;
    }
    const active = ch.id === state.chapter ? ' is-active' : '';
    const draft = ch.draft ? ' is-draft' : '';
    const meta = ch.draft ? '—' : `${formatNumber(ch.words || 0)} 字`;
    html += `
      <button class="chapter-item${active}${draft}" type="button" data-chapter="${ch.id}">
        <span class="chapter-item__no">${escapeHtml(ch.no.replace('第', '').replace('章', ''))}</span>
        <span class="chapter-item__title">${escapeHtml(ch.title)}</span>
        <span class="chapter-item__meta">${meta}</span>
      </button>`;
  });
  html += `<button class="chapter-item chapter-item--add" type="button" data-action="newChapter">
      <svg class="icon"><use href="#i-plus"></use></svg> 新建章节
    </button>`;
  tree.innerHTML = html;
}

function renderChapter() {
  const ch = currentChapter();
  if (!ch) return;
  $('#chapterVol').textContent = ch.vol;
  $('#chapterNo').textContent = ch.no;
  $('#chapterTitle').textContent = ch.title;
  $('#chapterStatus').textContent = ch.status;
  $('#editor').innerHTML = ch.content || '';
  $('#editor').dataset.placeholder = '这一章还没有开始。写下第一句话，或者让 AI 起个头。';
  $$('.chapter-item[data-chapter]').forEach((b) => b.classList.toggle('is-active', b.dataset.chapter === ch.id));
  const ghost = $('#ghostBlock');
  if (ghost) {
    const canShow = ch.id === 'ch7' && !state.ghostAccepted;
    ghost.classList.toggle('is-hidden', !canShow);
    ghost.style.display = canShow ? '' : 'none';
    if (canShow) ghost.style.display = '';
  }
  updateWordCounts();
  const words = ch.words || 0;
  $('#readingTime').textContent = `约 ${Math.max(1, Math.ceil(words / 400))} 分钟阅读`;
  $('#chapterWords').textContent = `${formatNumber(words)} 字`;
  $('#statusWords').textContent = formatNumber(words);
  $('#docScroll').scrollTop = 0;
  $('#saveText').textContent = '已保存';
  $('#saveDot').style.background = 'var(--jade)';
  renderPanelNote(ch);
}

function renderPanelNote(ch) {
  const noteEl = $('.panel-note');
  if (!noteEl) return;
  const note = CHAPTER_NOTES[ch.id];
  if (!note) {
    noteEl.hidden = true;
    return;
  }
  noteEl.hidden = false;
  const p = $('p', noteEl);
  if (p) p.textContent = note.text;
  const foot = $('.panel-note__foot', noteEl);
  if (foot) {
    foot.innerHTML = `${note.tags.map((t) => `<span># ${escapeHtml(t)}</span>`).join('')}<em>${escapeHtml(note.time)}</em>`;
  }
}

function syncEditor() {
  const ch = currentChapter();
  if (!ch) return;
  ch.content = $('#editor').innerHTML;
  updateChapterWordMeta(ch);
  ch.title = $('#chapterTitle').textContent.trim() || ch.title;
  updateWordCounts();
}

function updateWordCounts() {
  const ch = currentChapter();
  const words = countWords($('#editor') ? $('#editor').innerHTML : '');
  ch.words = words;
  $('#chapterWords').textContent = `${formatNumber(words)} 字`;
  $('#statusWords').textContent = formatNumber(words);
  $('#readingTime').textContent = `约 ${Math.max(1, Math.ceil(words / 400))} 分钟阅读`;
  const meta = $(`.chapter-item[data-chapter="${ch.id}"] .chapter-item__meta`);
  if (meta) meta.textContent = `${formatNumber(words)} 字`;
}

/* ============================================================
   设置 / 模型 / 记忆
   ============================================================ */

function resetAIPanelForProject(p) {
  if (!p.memory) p.memory = [p.title || '当前作品'];
  if (!p.aiWelcome) p.aiWelcome = `已打开《${p.title}》。想从哪里开始？`;
  const welcome = $('#aiWelcome');
  if (welcome) welcome.textContent = p.aiWelcome;
  const chips = $('#memoryChips');
  if (chips) {
    chips.innerHTML = p.memory
      .map((m, i) => {
        const icons = ['i-type', 'i-users', 'i-pin', 'i-flag'];
        return `<span class="memory-chip"><svg class="icon"><use href="#${icons[i % 4]}"></use></svg> ${escapeHtml(m)}</span>`;
      })
      .join('') + `<button class="memory-add" type="button" data-action="addMemory" aria-label="添加记忆">+</button>`;
  }
  renderChatForProject(p);
  renderQuickActions(p);
  const tokens = $('.memory-card__tokens');
  if (tokens) tokens.textContent = p.id === 'fog' ? '38.2k / 128k' : '1.4k / 128k';
  const memBar = $('.memory-card__bar i');
  if (memBar) memBar.style.width = p.id === 'fog' ? '30%' : '4%';
  const checkTab = $('.ai-tab[data-ai-tab="check"]');
  if (checkTab) checkTab.hidden = p.id !== 'fog';
  setAITab('write');
}

function renderQuickActions(p) {
  const el = $('#quickActions');
  if (!el) return;
  let actions = [
    ['写一个能抓住读者的开场。', '写一个开场'],
    ['为这一章设计一个清晰的冲突。', '设计冲突'],
    ['给我三个不同风格的第一句话。', '三个开头'],
    ['让这段叙述更克制。', '更克制'],
  ];
  if (p.id === 'fog') {
    actions = [
      ['续写下一段，保持第一人称的压迫感。', '续写下一段'],
      ['加强这一段的雨夜氛围，多用听觉和触觉。', '加强氛围'],
      ['写一段沈砚与访客的对话，每句话都不超过十五个字。', '补一段对白'],
      ['在下一个场景里埋一条关于旧船票的伏笔。', '埋一个伏笔'],
    ];
  } else if (p.id === 'ferry') {
    actions = [
      ['收紧悬念：让老周发现船票背面的字，但不要解释。', '收紧悬念'],
      ['补一段老周三年前的过去。', '补人物过去'],
      ['写一个结尾反转：女人的身份与老周有关。', '想一个反转'],
      ['让这一段的雨声更具体。', '加强氛围'],
    ];
  }
  el.innerHTML = actions
    .map(([prompt, label]) => `<button type="button" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`)
    .join('');
}

/* ============================================================
   AI 共笔
   ============================================================ */

function aiAvatar() {
  return `<div class="msg__avatar"><svg class="icon"><use href="#i-spark"></use></svg></div>`;
}

function renderChatForProject(p, fresh = false) {
  const chat = $('#chat');
  if (!chat) return;
  if (fresh) {
    chat.innerHTML = `
      <div class="msg msg--ai">
        ${aiAvatar()}
        <div class="msg__main">
          <div class="msg__name">共笔助手 <span>新的对话</span></div>
          <div class="msg__bubble">${escapeHtml(p.aiWelcome)}</div>
        </div>
      </div>`;
    return;
  }
  if (p.id !== 'fog') {
    const quick = p.id === 'ferry'
      ? [
          ['先把悬念收紧：让老周发现船票上的日期有问题，但不要解释。', '收紧悬念'],
          ['补一段老周三年前的过去，解释他为什么把票送出去。', '补人物过去'],
          ['写一个结尾反转：女人的身份与老周有关。', '想一个反转'],
        ]
      : [
          ['根据刚才的故事方案，写一个能抓住读者的开场。', '写开场'],
          ['先为这一章设计一个清晰的场景目标。', '设计场景'],
          ['给我三个不同的第一句话，风格要克制。', '三个开头'],
        ];
    chat.innerHTML = `
      <div class="msg msg--ai">
        ${aiAvatar()}
        <div class="msg__main">
          <div class="msg__name">共笔助手 <span>新的故事</span></div>
          <div class="msg__bubble">${escapeHtml(p.aiWelcome)}</div>
        </div>
      </div>`;
    return;
  }

  aiMsgSeq = 1;
  aiTextStore.set('preset', {
    html: '<p>门外的男人没有再敲。他把伞收得很慢，伞骨刮过墙面，发出一种类似牙齿打颤的轻响。</p><p>沈砚没有动。他盯着门缝下那线昏黄的光，看见一双湿透的皮鞋缓慢地换了重心——门外的人也在等，等他先犯错。</p>',
    text: '门外的男人没有再敲。他把伞收得很慢，伞骨刮过墙面，发出一种类似牙齿打颤的轻响。\n\n沈砚没有动。他盯着门缝下那线昏黄的光，看见一双湿透的皮鞋缓慢地换了重心——门外的人也在等，等他先犯错。',
  });

  chat.innerHTML = `
    <div class="msg msg--ai">
      ${aiAvatar()}
      <div class="msg__main">
        <div class="msg__name">共笔助手 <span>读完上下文后</span></div>
        <div class="msg__bubble">${escapeHtml(p.aiWelcome)}</div>
        <div class="msg__quick">
          <button type="button" data-prompt="先写气氛：雨夜、黑暗和门缝里的光，不要揭晓访客身份。">先写气氛</button>
          <button type="button" data-prompt="推进访客身份，但只给一个不可靠的线索。">推进身份</button>
          <button type="button" data-prompt="给沈砚加一个下意识的动作，暗示他认识这个人。">加一个暗示</button>
        </div>
      </div>
    </div>

    <div class="msg msg--user">
      <div class="msg__main">
        <div class="msg__bubble">访客敲门后，先不要揭晓身份，把紧张感拉满。</div>
      </div>
    </div>

    <div class="msg msg--ai">
      ${aiAvatar()}
      <div class="msg__main">
        <div class="msg__name">共笔助手 <span>12 秒前 · 4 项记忆</span></div>
        <div class="msg__bubble msg__bubble--prose">
          <p>门外的男人没有再敲。他把伞收得很慢，伞骨刮过墙面，发出一种类似牙齿打颤的轻响。</p>
          <p>沈砚没有动。他盯着门缝下那线昏黄的光，看见一双湿透的皮鞋缓慢地换了重心——门外的人也在等，等他先犯错。</p>
        </div>
        <div class="msg__actions">
          <button class="msg-action" type="button" data-insert-ai="preset"><svg class="icon"><use href="#i-insert"></use></svg> 插入正文</button>
          <button class="msg-action" type="button" data-action="replaceAI">替换选中</button>
          <button class="msg-action" type="button" data-action="rewriteAI"><svg class="icon"><use href="#i-refresh"></use></svg> 更克制</button>
          <button class="icon-btn icon-btn--sm" type="button" data-action="copyAI" aria-label="复制"><svg class="icon"><use href="#i-copy"></use></svg></button>
        </div>
        <div class="msg__meta">生成于 12 秒前 · 使用 ${escapeHtml(currentModelLabel())}</div>
      </div>
    </div>`;
}

function pickResponse(prompt) {
  const projectId = currentProject().id;
  if (projectId === 'ferry') {
    return AI_RESPONSES_FERRY[/对白|对话/.test(prompt) ? 1 : 0];
  }
  if (projectId !== 'fog') {
    return AI_RESPONSES_NEW[/克制|建议|结构/.test(prompt) ? 1 : 0];
  }
  if (/对白|对话/.test(prompt)) return AI_RESPONSES[2];
  if (/伏笔|暗示|埋/.test(prompt)) return AI_RESPONSES[3];
  if (/氛围|雨|环境|描写/.test(prompt)) return AI_RESPONSES[1];
  return AI_RESPONSES[0];
}

function scrollChat() {
  const body = $('#aiBody');
  if (body) body.scrollTop = body.scrollHeight;
}

function appendUserMessage(text) {
  const chat = $('#chat');
  const msg = document.createElement('div');
  msg.className = 'msg msg--user';
  msg.innerHTML = `<div class="msg__main"><div class="msg__bubble"></div></div>`;
  $('.msg__bubble', msg).textContent = text;
  chat.appendChild(msg);
  scrollChat();
}

function sendAIPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (state.streaming) return;
  if (!text) {
    toast('先写一句你想让 AI 做什么', 'warn');
    $('#aiInput')?.focus();
    return;
  }
  const chat = $('#chat');
  if (!chat) return;

  appendUserMessage(text);
  const input = $('#aiInput');
  if (input) input.value = '';

  const response = pickResponse(text);
  const id = `msg-${++aiMsgSeq}`;
  aiTextStore.set(id, {
    html: response.paragraphs.map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join(''),
    text: response.paragraphs.join('\n\n'),
  });

  const msg = document.createElement('div');
  msg.className = 'msg msg--ai';
  msg.dataset.msgId = id;
  msg.innerHTML = `
    ${aiAvatar()}
    <div class="msg__main">
      <div class="msg__name">共笔助手 <span>正在生成…</span></div>
      <div class="msg__bubble msg__bubble--prose" style="white-space:pre-wrap"></div>
      <div class="msg__typing"><i></i><i></i><i></i></div>
    </div>`;
  chat.appendChild(msg);
  scrollChat();

  state.streaming = true;
  $('#aiSend').disabled = true;
  const bubble = $('.msg__bubble', msg);
  const typing = $('.msg__typing', msg);
  typing.remove();

  const fullText = response.paragraphs.join('\n\n');
  let i = 0;
  const timer = setInterval(() => {
    i += 2;
    bubble.textContent = fullText.slice(0, i);
    scrollChat();
    if (i >= fullText.length) {
      clearInterval(timer);
      bubble.innerHTML = aiTextStore.get(id).html;
      bubble.style.whiteSpace = '';
      const name = $('.msg__name span', msg);
      if (name) name.textContent = '刚刚 · 4 项记忆';
      const actions = document.createElement('div');
      actions.className = 'msg__actions';
      actions.innerHTML = `
        <button class="msg-action" type="button" data-insert-ai="${id}"><svg class="icon"><use href="#i-insert"></use></svg> 插入正文</button>
        <button class="msg-action" type="button" data-action="replaceAI">替换选中</button>
        <button class="msg-action" type="button" data-action="rewriteAI"><svg class="icon"><use href="#i-refresh"></use></svg> 更克制</button>
        <button class="icon-btn icon-btn--sm" type="button" data-action="copyAI" aria-label="复制"><svg class="icon"><use href="#i-copy"></use></svg></button>`;
      const msgMain = $('.msg__main', msg);
      msgMain.appendChild(actions);
      const meta = document.createElement('div');
      meta.className = 'msg__meta';
      meta.textContent = `生成于刚刚 · 使用 ${currentModelLabel()}`;
      msgMain.appendChild(meta);
      state.streaming = false;
      $('#aiSend').disabled = false;
      scrollChat();
    }
  }, 18);
}

function insertAIResponse(id, button) {
  const data = aiTextStore.get(id);
  if (!data) return;
  const ch = currentChapter();
  if (!ch) return;
  const editor = $('#editor');
  editor.insertAdjacentHTML('beforeend', data.html.replace(/<p>/g, '<p class="ai-para">'));
  ch.content = editor.innerHTML;
  updateChapterWordMeta(ch);
  updateWordCounts();
  state.ghostAccepted = true;
  $('#ghostBlock').classList.add('is-hidden');
  $('#ghostBlock').style.display = 'none';
  if (button) {
    button.textContent = '已插入正文';
    button.disabled = true;
    button.style.color = 'var(--jade)';
  }
  const end = $('.editor-end');
  if (end) end.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('AI 续写已插入正文，可继续修改');
}

function setAITab(tab) {
  state.aiTab = tab;
  $$('.ai-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.aiTab === tab));
  const body = $('#aiBody');
  const check = $('#aiCheck');
  const composer = $('#aiComposer');
  if (tab === 'check') {
    if (body) body.hidden = true;
    if (check) check.hidden = false;
    if (composer) composer.hidden = true;
  } else {
    if (body) body.hidden = false;
    if (check) check.hidden = true;
    if (composer) composer.hidden = false;
  }
}

/* ============================================================
   大纲
   ============================================================ */

const BEAT_FALLBACK = {
  goal: '让本章承担一个明确的结构功能：推进调查，或改变人物关系。',
  conflict: '让人物想要的东西与必须付出的代价正面相撞。',
  info: '只释放一个读者需要记住的新信息，其余留到下一章。',
  tip: '写完这一章后，回到伏笔台账确认它是否与前后章形成呼应。',
};

function updateInsight(card) {
  let data = null;
  if (card.dataset.insight) {
    try {
      data = JSON.parse(card.dataset.insight);
    } catch (e) {
      data = null;
    }
  }
  const no = Number(card.dataset.beat || 0);
  const cn = numberToChinese(no);
  const title = $('.beat__body strong', card);
  const desc = $('.beat__body em', card);
  if (!data) {
    data = {
      title: `第${cn}章 · ${title ? title.textContent : '未命名场景'}`,
      text: desc ? desc.textContent : '这一章还没有展开。让 AI 先给出三种可能，再选择一个最不像套路的。',
      ...BEAT_FALLBACK,
    };
  }
  data.title = data.title.replace(/^第\s*[一二三四五六七八九十百零\d]+\s*章\s*·\s*/, `第${cn}章 · `);
  $('#insightTitle').textContent = data.title;
  $('#insightText').textContent = data.text;
  $('#insightGoal').textContent = data.goal;
  $('#insightConflict').textContent = data.conflict;
  $('#insightInfo').textContent = data.info;
  $('#insightTip').textContent = data.tip;
  const tooltip = $('#chartTooltip');
  if (tooltip) {
    $('span', tooltip).textContent = `第${cn}章 · ${title ? title.textContent : ''}`;
    $('strong', tooltip).textContent = `张力 ${(7.4 + (no % 5) * 0.3).toFixed(1)}`;
    $('em', tooltip).textContent = desc ? desc.textContent : 'AI 正在估算这一章的张力';
    const left = Math.min(72, 8 + (no / 24) * 72);
    tooltip.style.right = 'auto';
    tooltip.style.left = `${left}%`;
    tooltip.style.top = '5%';
  }
  $$('.beat').forEach((b) => b.classList.toggle('is-active', b === card));
}

/* ============================================================
   设定库
   ============================================================ */

function renderCharacters() {
  // 静态 HTML 已包含完整人物卡，动画与选中由事件控制
}

function renderEntities() {
  const loc = $('#locationGrid');
  if (loc) {
    loc.innerHTML = LOCATIONS.map(
      (l) => `
      <article class="entity-card">
        <div class="entity-card__head">
          <span class="entity-card__icon"><svg class="icon"><use href="#i-pin"></use></svg></span>
          <h4>${escapeHtml(l.name)}</h4><span>${escapeHtml(l.meta)}</span>
        </div>
        <p>${escapeHtml(l.desc)}</p>
        <div class="entity-card__foot">${l.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      </article>`
    ).join('');
  }
  const org = $('#orgGrid');
  if (org) {
    org.innerHTML = ORGANIZATIONS.map(
      (o) => `
      <article class="entity-card">
        <div class="entity-card__head">
          <span class="entity-card__icon"><svg class="icon"><use href="#i-shield"></use></svg></span>
          <h4>${escapeHtml(o.name)}</h4><span>${escapeHtml(o.meta)}</span>
        </div>
        <p>${escapeHtml(o.desc)}</p>
        <div class="entity-card__foot">${o.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      </article>`
    ).join('');
  }
  const prop = $('#propGrid');
  if (prop) {
    prop.innerHTML = PROPS.map(
      (o) => `
      <article class="entity-card">
        <div class="entity-card__head">
          <span class="entity-card__icon"><svg class="icon"><use href="#i-box"></use></svg></span>
          <h4>${escapeHtml(o.name)}</h4><span>${escapeHtml(o.meta)}</span>
        </div>
        <p>${escapeHtml(o.desc)}</p>
        <div class="entity-card__foot">${o.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      </article>`
    ).join('');
  }
}

function renderTimeline() {
  const el = $('#timelineList');
  if (!el) return;
  el.innerHTML = TIMELINE.map(
    (t) => `
    <div class="timeline-item${t.key ? ' is-key' : ''}">
      <div class="timeline-item__date">${escapeHtml(t.date)}${t.tag ? `<span class="tag">${escapeHtml(t.tag)}</span>` : ''}</div>
      <h4>${escapeHtml(t.title)}</h4>
      <p>${escapeHtml(t.desc)}</p>
    </div>`
  ).join('');
}

function renderForeshadow() {
  const el = $('#foreshadowTable');
  if (!el) return;
  el.innerHTML = `
    <div class="foreshadow-row foreshadow-row--head"><span>伏笔</span><span>埋设</span><span>计划回收</span><span>状态</span></div>
    ${FORESHADOW.map(
      (f) => `
      <div class="foreshadow-row">
        <span><svg class="icon"><use href="#i-flag"></use></svg>${escapeHtml(f.name)}</span>
        <span>${escapeHtml(f.planted)}</span>
        <span>${escapeHtml(f.payoff)}</span>
        <span class="foreshadow-status ${f.cls}">${escapeHtml(f.status)}</span>
      </div>`
    ).join('')}`;
}

function setCodexTab(tab) {
  state.codexTab = tab;
  $$('#codexTabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.codexTab === tab));
  $$('#codexNav .codex-nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.codexCat === tab));
  $$('.codex-pane').forEach((p) => {
    const active = p.dataset.codexPane === tab;
    p.classList.toggle('is-active', active);
    p.hidden = !active;
  });
  const wide = tab !== 'characters';
  $('#codexBody').classList.toggle('is-wide', wide);
  if (wide) $('#codexBody').classList.remove('has-inspector');
  const query = $('#codexSearch')?.value || '';
  filterCodex(query);
}

function setCharacter(id) {
  const c = CHARACTERS[id];
  if (!c) return;
  state.codexChar = id;
  $$('.char-card').forEach((card) => card.classList.toggle('is-active', card.dataset.char === id));
  const avatar = $('#insAvatar');
  avatar.className = `char-avatar ${c.avatar} char-avatar--lg`;
  avatar.textContent = c.char;
  $('#insName').textContent = c.name;
  $('#insRole').textContent = c.role;
  $('#insQuote').textContent = c.quote;
  $('#insAge').textContent = c.age;
  $('#insAppear').textContent = c.appear;
  $('#insPov').textContent = c.pov;
  $('#insDesc').textContent = c.desc;
  $('#insSecret').textContent = c.secret;
  $('#insTags').innerHTML = c.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('');
  $('#insRelations').innerHTML = c.relations
    .map(
      (r) => `
      <div class="rel-row">
        <span class="char-avatar ${r.avatar} char-avatar--xs">${r.char}</span>
        <div><strong>${escapeHtml(r.name)}</strong><em>${escapeHtml(r.rel)}</em></div>
        <span class="rel-tension">${escapeHtml(r.tension)}</span>
      </div>`
    )
    .join('');
  const tip = $('#codexInspector .ai-tip p');
  if (tip) tip.textContent = c.tip;
}

/* ============================================================
   剧本
   ============================================================ */

function renderSceneTree() {
  const tree = $('#sceneTree');
  if (!tree) return;
  let html = '';
  let lastGroup = '';
  SCENES.forEach((s) => {
    if (s.group !== lastGroup) {
      lastGroup = s.group;
      html += `<div class="scene-group">${escapeHtml(s.group)}</div>`;
    }
    const active = s.id === state.scriptScene ? ' is-active' : '';
    html += `
      <button class="scene-item${active}" type="button" data-scene="${s.id}">
        <span class="scene-item__no">${s.no}</span>
        <span class="scene-item__body"><strong>${escapeHtml(s.place)}</strong><em>${escapeHtml(s.time)}</em></span>
        <span class="scene-item__page">${s.pages} 页</span>
      </button>`;
  });
  tree.innerHTML = html;
}

function currentScene() {
  return SCENES.find((s) => s.id === state.scriptScene) || SCENES[2];
}

function renderBoards(scene = currentScene()) {
  const meta = SCENE_BOARDS[scene.id] || SCENE_BOARDS.s12;
  const title = $('#boardTitle');
  const sub = $('#boardSubtitle');
  if (title) title.textContent = meta.name;
  if (sub) sub.textContent = meta.sub;
  $$('.shot-card').forEach((card, i) => {
    const shot = meta.shots[i];
    if (!shot) return;
    const strong = $('.shot-info strong', card);
    const p = $('.shot-info p', card);
    const label = $('.shot-frame__label', card);
    if (strong) strong.textContent = shot[0];
    if (p) p.textContent = shot[1];
    if (label) label.textContent = shot[2];
  });
}

function renderScene(id) {
  const scene = SCENES.find((s) => s.id === id) || SCENES[2];
  state.scriptScene = scene.id;
  $('#scriptPage').innerHTML = `${scene.heading ? `<div class="scene-heading">${escapeHtml(scene.heading)}</div>` : ''}${scene.body}`;
  $('#pageNo').textContent = `${scene.no}.`;
  const modePage = $('#modePage');
  if (modePage) modePage.textContent = scene.no;
  $('#sceneName').textContent = scene.name;
  const scores = $$('.score strong');
  if (scores.length === 3) {
    scores[0].textContent = scene.scores[0];
    scores[1].textContent = scene.scores[1];
    scores[2].textContent = scene.scores[2];
  }
  $('#sceneFunction').textContent = scene.func;
  $('#sceneSubtext').textContent = scene.subtext;
  $('#sceneTip').textContent = scene.tip;
  $('#sceneCast').innerHTML = scene.cast
    .map((cid) => {
      const c = CHARACTERS[cid];
      return `<span><i class="char-avatar ${c.avatar} char-avatar--xs">${c.char}</i>${c.name}</span>`;
    })
    .join('');
  $$('.scene-item').forEach((b) => b.classList.toggle('is-active', b.dataset.scene === scene.id));
}

function setScriptMode(mode, rerenderTop = true) {
  state.scriptMode = mode;
  $$('#scriptModes button').forEach((b) => b.classList.toggle('is-active', b.dataset.scriptMode === mode));
  $$('.script-pane').forEach((p) => {
    const active = p.dataset.scriptPane === mode;
    p.classList.toggle('is-active', active);
    p.hidden = !active;
  });
  if (mode === 'boards') renderBoards(currentScene());
  if (rerenderTop) renderTopbar();
}

/* ============================================================
   弹窗 / 下拉
   ============================================================ */

function closeAllPopovers() {
  $$('.popover').forEach((p) => {
    if (p.id !== 'modelPopover') p.remove();
    else p.hidden = true;
  });
  const ap = $('#annotationPop');
  if (ap) ap.hidden = true;
}

function openPopoverAt(el, anchor, width = 246) {
  if (!el || !anchor) return;
  el.hidden = false;
  el.style.position = 'fixed';
  el.style.width = `${width}px`;
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.bottom + 7, window.innerHeight - el.offsetHeight - 12);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

function openModal(target) {
  const overlay = $('#overlay');
  $$('.modal', overlay).forEach((m) => (m.hidden = m.id !== target));
  overlay.hidden = false;
  setTimeout(() => {
    const modal = $(`#${target}`);
    const first = modal?.querySelector('input:not([type="hidden"]), textarea, select')
      || modal?.querySelector('.type-option, button:not([disabled])');
    if (first) first.focus();
  }, 60);
}

function closeModal() {
  const overlay = $('#overlay');
  if (overlay) overlay.hidden = true;
  $$('.modal', overlay).forEach((m) => (m.hidden = true));
}

function setWizardStep(step) {
  state.wizardStep = step;
  $$('.wizard-step').forEach((s, i) => {
    s.classList.toggle('is-active', i + 1 === step);
    s.classList.toggle('is-done', i + 1 < step);
  });
  $$('.wizard-body').forEach((b) => {
    b.hidden = Number(b.dataset.wizardStep) !== step;
  });
  const back = $('#wizardBack');
  const next = $('#wizardNext');
  const hint = $('#wizardHint');
  back.hidden = step === 1 || step === 3;
  next.disabled = false;
  if (step === 1) {
    next.innerHTML = 'AI 生成创作方案 <svg class="icon"><use href="#i-spark"></use></svg>';
    hint.textContent = 'AI 会根据你的灵感生成可编辑的方案，不会直接替你写完。';
  } else if (step === 2) {
    next.innerHTML = '采用方案，开始写作 <svg class="icon"><use href="#i-arrow-right"></use></svg>';
    hint.textContent = '方案中的标题、人物和结构都可以在创建后继续修改。';
  } else {
    next.innerHTML = '进入写作台 <svg class="icon"><use href="#i-arrow-right"></use></svg>';
    hint.textContent = '初稿、人物档案和伏笔台账已经准备好。';
    const createdText = $('.created-state p');
    if (createdText) createdText.textContent = `《${state.wizardTitle}》已创建。你可以直接开写，也可以先调整大纲。`;
  }
}

function resetWizard() {
  state.wizardStep = 1;
  state.wizardLoading = false;
  state.wizardType = 'novel';
  state.wizardTitle = '潮汐表上没有的名字';
  $$('.type-option').forEach((b) => b.classList.toggle('is-active', b.dataset.type === 'novel'));
  $$('#toneOptions .chip').forEach((b, i) => b.classList.toggle('is-active', i === 0));
  $$('#lengthOptions .chip').forEach((b, i) => b.classList.toggle('is-active', i === 1));
  const title = $('#newTitle');
  if (title) title.value = '';
  const premise = $('#newPremise');
  if (premise) premise.value = TEMPLATE_PRESETS.novel.premise;
  const genre = $('#newGenre');
  if (genre) genre.value = TEMPLATE_PRESETS.novel.genre;
  const proposal = $('#wizardProposal');
  if (proposal) proposal.hidden = true;
  const loading = $('#wizardLoading');
  if (loading) loading.hidden = false;
  const next = $('#wizardNext');
  if (next) next.disabled = false;
  setWizardStep(1);
}

function generateProposal() {
  state.wizardLoading = true;
  $('#wizardLoading').hidden = false;
  $('#wizardProposal').hidden = true;
  const nextBtn = $('#wizardNext');
  if (nextBtn) {
    nextBtn.disabled = true;
    nextBtn.innerHTML = '正在生成方案…';
  }
  const titleInput = $('#newTitle').value.trim();
  const premise = $('#newPremise').value.trim();
  if (titleInput) state.wizardTitle = titleInput;
  if (premise) {
    $('.proposal__head p').textContent = premise.length > 78 ? `${premise.slice(0, 78)}…` : premise;
  }
  $('.proposal__head h3').textContent = state.wizardTitle;
  setTimeout(() => {
    if (state.wizardStep !== 2) return;
    state.wizardLoading = false;
    $('#wizardLoading').hidden = true;
    $('#wizardProposal').hidden = false;
    if (nextBtn && state.wizardStep === 2) {
      nextBtn.disabled = false;
      nextBtn.innerHTML = '采用方案，开始写作 <svg class="icon"><use href="#i-arrow-right"></use></svg>';
    }
  }, 1300);
}

function openProjectMenu(anchor) {
  closeAllPopovers();
  const menu = document.createElement('div');
  menu.className = 'popover';
  menu.style.width = '196px';
  menu.innerHTML = `
    <div class="popover__head">作品操作</div>
    <button class="popover__item" type="button" data-action="projectInfo"><span><strong>作品信息</strong><em>标题、封面与统计</em></span></button>
    <button class="popover__item" type="button" data-action="export"><span><strong>导出作品</strong><em>Word / PDF / Markdown</em></span></button>
    <button class="popover__item" type="button" data-action="archiveProject"><span><strong>归档作品</strong><em>移出进行中的列表</em></span></button>`;
  document.body.appendChild(menu);
  openPopoverAt(menu, anchor, 196);
}

/* ============================================================
   导出 / 设置
   ============================================================ */

function openExportModal() {
  openModal('exportModal');
}

/* ============================================================
   专注模式 / 搜索
   ============================================================ */

function toggleFocus(force) {
  state.focus = typeof force === 'boolean' ? force : !state.focus;
  $('#app').classList.toggle('focus-mode', state.focus);
  if (state.focus) toast('专注模式已开启 · 按 Esc 退出', 'warn');
}

function focusLibrarySearch() {
  if (state.focus) toggleFocus(false);
  if ($('#settingsOverlay') && !$('#settingsOverlay').hidden) closeSettings();
  if (state.view !== 'library') setView('library');
  setTimeout(() => $('#libSearch').focus(), 80);
}

const PROJECT_SEARCH_TEXT = {
  fog: '雨夜的访客 潮汐表 被撕掉的一页 灯塔没有影子 沈砚 林雾 周隐 沈鹭 雾港 白鸥号',
  ferry: '末班船 河面下的灯 空座位 老周 末班渡轮 船票',
  echo: '渡轮底舱 声音修复室 沈砚家 林雾 沈砚 录音带 回声',
};

function filterLibraryProjects() {
  const q = ($('#libSearch')?.value || '').trim().toLowerCase();
  const activeFilter = $('#libFilters .is-active')?.dataset.filter || 'all';
  let visible = 0;
  $$('#projectGrid .project-card').forEach((card) => {
    if (card.classList.contains('project-card--new')) return;
    const text = card.textContent.toLowerCase();
    const extra = PROJECT_SEARCH_TEXT[card.dataset.project] || '';
    const matchesQuery = !q || text.includes(q) || extra.toLowerCase().includes(q);
    const matchesFilter = activeFilter === 'all' || card.dataset.filter === activeFilter;
    const show = matchesQuery && matchesFilter;
    card.classList.toggle('is-dimmed', !show);
    if (show) visible += 1;
  });
  $$('#projectGrid .project-card--new').forEach((card) => card.classList.toggle('is-dimmed', Boolean(q)));
  const empty = $('#libraryEmpty');
  if (empty) {
    empty.hidden = visible > 0;
    const label = $('#emptyQuery');
    if (label) label.textContent = q ? `没有找到与「${q}」匹配的作品` : '这个分类下还没有作品';
  }
}

function clearLibrarySearch() {
  const input = $('#libSearch');
  if (input) input.value = '';
  filterLibraryProjects();
}

function filterCodex(q) {
  const query = q.trim().toLowerCase();
  const activePane = $(`.codex-pane[data-codex-pane="${state.codexTab}"]`);
  if (!activePane) return;
  let visible = 0;
  const items = $$('.char-card, .entity-card, .timeline-item, .foreshadow-row:not(.foreshadow-row--head)', activePane);
  items.forEach((el) => {
    const match = !query || el.textContent.toLowerCase().includes(query);
    el.style.display = match ? '' : 'none';
    if (match) visible += 1;
  });
  const empty = $('#codexEmpty');
  const isEmpty = Boolean(query) && visible === 0;
  if (empty) empty.hidden = !isEmpty;
  const inspector = $('#codexInspector');
  if (inspector) inspector.hidden = isEmpty && state.codexTab === 'characters';
}

/* ============================================================
   事件绑定
   ============================================================ */

document.addEventListener('click', (e) => {
  const target = e.target;

  // 设置中心：tab、主题、主题色
  const settingsTab = target.closest('[data-settings-tab]');
  if (settingsTab) {
    setSettingsTab(settingsTab.dataset.settingsTab);
    return;
  }
  const themeChoice = target.closest('[data-theme-choice]');
  if (themeChoice) {
    appearance.theme = themeChoice.dataset.themeChoice;
    applyAppearance(true);
    return;
  }
  const accentChoice = target.closest('[data-accent-choice]');
  if (accentChoice) {
    appearance.accent = accentChoice.dataset.accentChoice;
    appearance.customAccent = null;
    applyAppearance(true);
    return;
  }
  if (target.id === 'settingsOverlay') {
    closeSettings();
    return;
  }
  if (target.id === 'providerLayer') {
    closeProviderPanel();
    return;
  }
  if (target.id === 'providerCatalogLayer') {
    closeProviderCatalog();
    return;
  }

  // 点击空白关闭浮层
  if (!target.closest('.popover') && !target.closest('[data-action="modelMenu"]') && !target.closest('[data-action="projectMenu"]')) {
    $$('.popover').forEach((p) => {
      if (p.id === 'modelPopover') p.hidden = true;
      else p.remove();
    });
  }
  if (!target.closest('#annotationPop') && !target.closest('.mark') && !target.closest('.annotation-pin')) {
    const ap = $('#annotationPop');
    if (ap) ap.hidden = true;
  }

  const closeBtn = target.closest('[data-close]');
  if (closeBtn) {
    closeModal();
    return;
  }
  if (target.closest('#overlay') === target) {
    closeModal();
    return;
  }

  const nav = target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    setView(nav.dataset.nav);
    return;
  }

  const open = target.closest('[data-open]');
  if (open) {
    const what = open.dataset.open;
    if (what === 'newProject') {
      resetWizard();
      openModal('newProjectModal');
      if (open.dataset.template) {
        selectWizardType(open.dataset.template);
        applyTemplatePreset(open.dataset.template);
      }
    } else if (what === 'studio') {
      state.project = 'fog';
      state.chapter = 'ch7';
      state.ghostAccepted = false;
      resetAIPanelForProject(projects.fog);
      setView('studio');
    }
    return;
  }

  const projectCard = target.closest('.project-card[data-project]');
  if (projectCard && !target.closest('[data-action]')) {
    openProject(projectCard.dataset.project);
    return;
  }

  const chapterBtn = target.closest('[data-chapter]');
  if (chapterBtn) {
    syncEditor();
    state.chapter = chapterBtn.dataset.chapter;
    renderChapterTree();
    renderChapter();
    return;
  }

  const codexTab = target.closest('[data-codex-tab], [data-codex-cat]');
  if (codexTab) {
    setCodexTab(codexTab.dataset.codexTab || codexTab.dataset.codexCat);
    return;
  }

  const charCard = target.closest('[data-char]');
  if (charCard) {
    setCharacter(charCard.dataset.char);
    return;
  }

  const scene = target.closest('[data-scene]');
  if (scene) {
    if (state.scriptMode !== 'script') setScriptMode('script');
    renderScene(scene.dataset.scene);
    renderSceneTree();
    return;
  }

  const scriptMode = target.closest('[data-script-mode]');
  if (scriptMode) {
    setScriptMode(scriptMode.dataset.scriptMode);
    return;
  }
  const scriptTab = target.closest('[data-script-tab]');
  if (scriptTab) {
    setScriptMode(scriptTab.dataset.scriptTab);
    return;
  }

  const beat = target.closest('[data-beat]');
  if (beat) {
    updateInsight(beat);
    return;
  }

  const actItem = target.closest('.act-item');
  if (actItem) {
    $$('.act-item').forEach((b) => b.classList.toggle('is-active', b === actItem));
    const idx = Number(actItem.dataset.actIndex || 0);
    const actEl = $$('.acts .act')[idx];
    if (actEl) {
      const scroller = $('.view--outline');
      const top = actEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 84;
      scroller.scrollTo({ top, behavior: 'smooth' });
    }
    toast(['第一幕 · 潮声', '第二幕 · 暗流', '第三幕 · 退潮'][idx] || '已定位到这一幕', 'warn');
    return;
  }

  const promptBtn = target.closest('[data-prompt]');
  if (promptBtn) {
    sendAIPrompt(promptBtn.dataset.prompt);
    return;
  }

  const insertBtn = target.closest('[data-insert-ai]');
  if (insertBtn) {
    insertAIResponse(insertBtn.dataset.insertAi, insertBtn);
    return;
  }

  const aiTabBtn = target.closest('[data-ai-tab]');
  if (aiTabBtn) {
    setAITab(aiTabBtn.dataset.aiTab);
    return;
  }

  const modelKeyItem = target.closest('[data-model-key]');
  if (modelKeyItem) {
    setDefaultModelByKey(modelKeyItem.dataset.modelKey);
    $('#modelPopover').hidden = true;
    return;
  }

  const modelItem = target.closest('[data-model]');
  if (modelItem) {
    const name = modelItem.dataset.model;
    $('.model-pill').innerHTML = `${escapeHtml(name)} <svg class="icon"><use href="#i-chevron-down"></use></svg>`;
    $$('#modelPopover .popover__item').forEach((b) => b.classList.toggle('is-active', b === modelItem));
    $('#modelPopover').hidden = true;
    toast(`已切换到 ${name}`);
    return;
  }

  const filter = target.closest('#libFilters [data-filter]');
  if (filter) {
    $$('#libFilters button').forEach((b) => b.classList.toggle('is-active', b === filter));
    filterLibraryProjects();
    return;
  }

  const typeOpt = target.closest('.type-option');
  if (typeOpt) {
    selectWizardType(typeOpt.dataset.type);
    return;
  }

  const chip = target.closest('.chip-options .chip');
  if (chip) {
    const group = chip.parentElement;
    $$('.chip', group).forEach((b) => b.classList.toggle('is-active', b === chip));
    return;
  }

  const exportOpt = target.closest('[data-export]');
  if (exportOpt) {
    $$('.export-option').forEach((b) => b.classList.toggle('is-active', b === exportOpt));
    return;
  }

  const mark = target.closest('.mark, .annotation-pin');
  if (mark) {
    e.preventDefault();
    const pop = $('#annotationPop');
    pop.hidden = false;
    pop.style.position = 'fixed';
    const rect = mark.getBoundingClientRect();
    const width = 284;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 10, window.innerHeight - 210);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.width = `${width}px`;
    return;
  }

  const action = target.closest('[data-action]');
  if (action) {
    handleAction(action, e);
  }
});

function selectWizardType(type) {
  state.wizardType = type;
  $$('.type-option').forEach((b) => b.classList.toggle('is-active', b.dataset.type === type));
}

function applyTemplatePreset(key) {
  const preset = TEMPLATE_PRESETS[key];
  if (!preset) return;
  const premise = $('#newPremise');
  if (premise) premise.value = preset.premise;
  const genre = $('#newGenre');
  if (genre) genre.value = preset.genre;
  $$('#toneOptions .chip').forEach((b) => b.classList.toggle('is-active', b.textContent.trim() === preset.tone));
  $$('#lengthOptions .chip').forEach((b) => b.classList.toggle('is-active', b.textContent.trim() === preset.length));
}

function handleAction(el, e) {
  const action = el.dataset.action;

  switch (action) {
    case 'toggleFocus':
      toggleFocus();
      break;
    case 'toggleAI': {
      state.aiHidden = !state.aiHidden;
      $('.studio').classList.toggle('ai-hidden', state.aiHidden);
      toast(state.aiHidden ? 'AI 面板已收起' : 'AI 面板已展开');
      break;
    }
    case 'modelMenu': {
      const pop = $('#modelPopover');
      if (!pop.hidden) {
        pop.hidden = true;
      } else {
        pop.hidden = false;
        openPopoverAt(pop, el, 246);
      }
      break;
    }
    case 'projectMenu':
      e.stopPropagation();
      openProjectMenu(el);
      break;
    case 'newChapter': {
      syncEditor();
      const p = currentProject();
      if (!p.chapters) break;
      const last = p.chapters[p.chapters.length - 1];
      const n = p.nextChapterNo || p.chapters.length + 1;
      const ch = {
        id: `new-${Date.now()}`,
        vol: last?.vol || '正文',
        no: `第${numberToChinese(n)}章`,
        title: '未命名章节',
        status: '草稿',
        draft: false,
        content: '',
      };
      p.nextChapterNo = n + 1;
      p.chapters.push(ch);
      p.written = (p.written || 0) + 1;
      p.totalChapters = Math.max(p.totalChapters || 0, p.chapters.length);
      state.chapter = ch.id;
      state.ghostAccepted = true;
      renderStudioPanel();
      renderChapter();
      toast(`已创建第${numberToChinese(n)}章空白章节`);
      break;
    }
    case 'searchChapter':
      toast('章节搜索 · 原型演示');
      break;
    case 'chapterNote':
      toast('本章笔记已保存（原型演示）');
      break;
    case 'clearLibrarySearch':
      clearLibrarySearch();
      break;
    case 'clearCodexSearch': {
      const input = $('#codexSearch');
      if (input) input.value = '';
      filterCodex('');
      break;
    }
    case 'newScene':
      toast('新场次已创建（原型演示）');
      break;
    case 'export':
    case 'exportOutline':
    case 'exportCodex':
      openExportModal();
      break;
    case 'doExport': {
      const format = $('#exportFormats .chip.is-active')?.textContent || 'Word';
      closeModal();
      toast(`已开始导出 ${format}，完成后会通知你`);
      break;
    }
    case 'acceptGhost': {
      const text = $('#ghostBlock p').textContent;
      const editor = $('#editor');
      editor.insertAdjacentHTML('beforeend', `<p class="ai-para">${escapeHtml(text)}</p>`);
      state.ghostAccepted = true;
      $('#ghostBlock').classList.add('is-hidden');
      $('#ghostBlock').style.display = 'none';
      syncEditor();
      toast('已接受 AI 建议');
      break;
    }
    case 'dismissGhost':
      state.ghostAccepted = true;
      $('#ghostBlock').classList.add('is-hidden');
      $('#ghostBlock').style.display = 'none';
      toast('已忽略这条建议');
      break;
    case 'rerollGhost': {
      const variants = [
        '门外的男人没有再敲。他把伞收得很慢，伞骨刮过墙面，发出一种类似牙齿打颤的轻响。沈砚忽然想起，十年前那个雨夜，也有人这样站在门外。',
        '雨声把楼道填满了。沈砚听见皮箱落在水泥地上的闷响，然后是很长的安静。安静比敲门更让人不安。',
        '门缝下的光被什么挡住了。沈砚看见一双湿透的皮鞋，鞋尖朝着屋里。那人已经站了很久，却没有再敲第二下。',
      ];
      const cur = $('#ghostBlock p').textContent;
      const next = variants.find((v) => v !== cur) || variants[0];
      $('#ghostBlock p').textContent = next;
      break;
    }
    case 'acceptGhostTab':
      break;
    case 'insertDivider': {
      const editor = $('#editor');
      editor.insertAdjacentHTML('beforeend', '<p>＊　＊　＊</p>');
      syncEditor();
      toast('已插入场景分隔');
      break;
    }
    case 'annotate':
      toast('选中正文后点击批注，可添加一条新批注');
      break;
    case 'aiInline':
      toast('已选中内容，AI 润色建议已生成');
      break;
    case 'clearChat':
      renderChatForProject(currentProject(), true);
      toast('已开始新对话');
      break;
    case 'copyAI': {
      const msg = el.closest('.msg');
      const bubble = msg?.querySelector('.msg__bubble');
      const text = bubble?.innerText || '';
      navigator.clipboard?.writeText(text).catch(() => {});
      toast('已复制到剪贴板');
      break;
    }
    case 'replaceAI':
      toast('请先在正文中选中要替换的段落');
      break;
    case 'rewriteAI':
      toast('已用更克制的语气重写这一版');
      break;
    case 'addMemory':
      toast('记忆引用已加入本次对话');
      break;
    case 'runCheck':
      el.textContent = '检查中…';
      setTimeout(() => {
        el.textContent = '重新检查';
        toast('检查完成：发现 3 处可优化');
      }, 900);
      break;
    case 'fixCheck':
      toast('已定位到正文对应段落');
      break;
    case 'checkAll':
      toast('正在检查全书 12.6 万字，预计 20 秒');
      break;
    case 'diagnose':
      toast('节奏诊断：第二幕中段有 2 处张力回落');
      break;
    case 'generateOutline':
      toast('AI 正在推演第二幕的 5 个候选节拍');
      break;
    case 'addBeat':
      toast('新场景已添加，可在右侧编辑');
      break;
    case 'reorder':
      toast('已切换到卡片视图（原型演示）');
      break;
    case 'aiComplete':
      toast('AI 已补全 3 条人物关系与 1 个地点');
      break;
    case 'newCharacter':
      toast('新人物卡已创建（原型演示）');
      break;
    case 'deepenCharacter':
      toast('AI 正在为人物补充前史与说话习惯');
      break;
    case 'scriptStats':
      toast('全片预计 107 分钟 · 54 场 · 102 页');
      break;
    case 'generateBoards':
    case 'regenerateBoards':
      setScriptMode('boards');
      toast('已生成 6 个分镜草案');
      break;
    case 'refreshInspiration': {
      const quotes = [
        '如果访客带来的皮箱里，装的不是钱，而是一整箱从未寄出的信——故事会往哪里走？',
        '让林雾在关键时刻说一句只有沈鹭才知道的暗号，但她坚持说那是巧合。',
        '如果白鸥号其实没有沉，只是被所有人默契地从记忆里删除了呢？',
        '沈砚在妹妹的房间里找到一张合影，照片上多了一个他不认识的孩子。',
      ];
      const cur = $('.inspiration-card__quote').textContent;
      const next = quotes.find((q) => q !== cur) || quotes[0];
      $('.inspiration-card__quote').textContent = next;
      break;
    }
    case 'expandInspiration':
      toast('灵感推演已展开（原型演示）');
      break;
    case 'allActivity':
      toast('已加载全部创作动态');
      break;
    case 'editGoal':
      toast('目标编辑器（原型演示）');
      break;
    case 'focusSearch':
      focusLibrarySearch();
      break;
    case 'settings':
      openSettings('appearance');
      break;
    case 'closeSettings':
      closeSettings();
      break;
    case 'manageProviders':
      closeAllPopovers();
      openSettings('models');
      break;
    case 'openProviderCatalog':
      openProviderCatalog();
      break;
    case 'closeProviderCatalog':
      closeProviderCatalog();
      break;
    case 'toggleProvider':
      toggleProvider(el.dataset.providerId);
      break;
    case 'configureProvider':
      openProviderPanel(el.dataset.providerId);
      break;
    case 'closeProvider':
      closeProviderPanel();
      break;
    case 'toggleProviderKey': {
      const input = $('#providerKey');
      if (input) {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        el.innerHTML = `<svg class="icon"><use href="#${showing ? 'i-eye' : 'i-eye-off'}"></use></svg>`;
      }
      break;
    }
    case 'testProviderConnection':
      testProviderConnection();
      break;
    case 'saveProvider':
      saveProviderPanel();
      break;
    case 'fetchProviderModels':
      fetchProviderModels();
      break;
    case 'providerModelDefault': {
      if (!settingsState.draft) break;
      settingsState.draft.defaultModel = el.dataset.modelId;
      settingsState.draft.defaultChanged = true;
      if (!settingsState.draft.enabledModels.includes(el.dataset.modelId)) {
        settingsState.draft.enabledModels.push(el.dataset.modelId);
      }
      renderProviderModelList();
      break;
    }
    case 'addCatalogProvider':
      addCatalogProvider(el.dataset.providerId);
      break;
    case 'addCustomProvider':
      addCustomProvider();
      break;
    case 'resetAppearance':
      resetAppearanceSettings();
      break;
    case 'exportSettings':
      exportSettingsFile();
      break;
    case 'clearLocalData':
      clearLocalSettings();
      break;
    case 'noop':
      e.preventDefault();
      toast('正式版会打开对应厂商的 Key 申请页');
      break;
    case 'account':
      toast('马良 · 私家写手 Pro');
      break;
    case 'resolveAnnotation':
      $('#annotationPop').hidden = true;
      $$('.mark').forEach((m) => (m.style.borderBottom = 'none'));
      toast('批注已标记为已解决');
      break;
    case 'closeAnnotation':
      $('#annotationPop').hidden = true;
      break;
    case 'projectInfo':
      closeAllPopovers();
      toast('作品信息面板（原型演示）');
      break;
    case 'archiveProject':
      closeAllPopovers();
      toast('作品已归档（原型演示）');
      break;
    case 'rerollProposal': {
      const variants = [
        { title: '潮汐表上没有的名字', text: '一个替人写遗书的代笔人，收到一封写给自己的遗书。落款是明天，而写信人，是三年前已经死去的母亲。' },
        { title: '代笔人的最后一封信', text: '所有遗书都少了一个名字，包括他自己的。代笔人开始怀疑，自己写的每一封告别，都在替某个人抹去存在。' },
        { title: '落款是明天', text: '如果遗书的落款日期是明天，那么今天收到它的那个人，还剩多少时间可以改变结局？' },
      ];
      const cur = $('.proposal__head h3').textContent;
      const idx = Math.max(0, variants.findIndex((v) => v.title === cur));
      const next = variants[(idx + 1) % variants.length];
      $('.proposal__head h3').textContent = next.title;
      const premiseEl = $('.proposal__head p');
      if (premiseEl) premiseEl.textContent = next.text;
      const tag = $('.proposal__head .tag--accent');
      if (tag) tag.textContent = `AI 方案 · 候选 ${(idx % 3) + 2}/3`;
      state.wizardTitle = next.title;
      toast('已换一个故事方案');
      break;
    }
    default:
      break;
  }
}

/* ---------- 工具栏 ---------- */
$$('.tool-btn[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const editor = $('#editor');
    editor.focus();
    try {
      if (btn.dataset.cmd === 'formatBlock') {
        document.execCommand('formatBlock', false, btn.dataset.value || 'blockquote');
      } else {
        document.execCommand(btn.dataset.cmd, false, null);
      }
    } catch (err) {
      /* 原型环境忽略 */
    }
    syncEditor();
  });
});

/* ---------- 编辑区 ---------- */
const editorEl = $('#editor');
if (editorEl) {
  editorEl.addEventListener('input', () => {
    const dot = $('#saveDot');
    const saveText = $('#saveText');
    if (dot) dot.style.background = 'var(--gold)';
    if (saveText) saveText.textContent = '正在保存…';
    updateWordCounts();
    clearTimeout(window.__saveTimer);
    window.__saveTimer = setTimeout(() => {
      syncEditor();
      if (dot) dot.style.background = 'var(--jade)';
      if (saveText) saveText.textContent = '已保存';
    }, 800);
  });
  editorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !state.ghostAccepted) {
      const ghost = $('#ghostBlock');
      if (ghost && !ghost.classList.contains('is-hidden')) {
        e.preventDefault();
        handleAction($('[data-action="acceptGhost"]'), e);
      }
    }
  });
}

const titleEl = $('#chapterTitle');
if (titleEl) {
  titleEl.addEventListener('input', () => {
    const ch = currentChapter();
    if (!ch) return;
    ch.title = titleEl.textContent.trim() || '未命名章节';
    const item = $(`.chapter-item[data-chapter="${ch.id}"] .chapter-item__title`);
    if (item) item.textContent = ch.title;
  });
}

/* ---------- AI 输入 ---------- */
const aiInput = $('#aiInput');
if (aiInput) {
  aiInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendAIPrompt(aiInput.value);
    }
  });
  aiInput.addEventListener('input', () => {
    aiInput.style.height = 'auto';
    aiInput.style.height = `${Math.min(aiInput.scrollHeight, 96)}px`;
  });
}
$('#aiSend')?.addEventListener('click', () => sendAIPrompt(aiInput?.value));

/* ---------- 弹窗内按钮 ---------- */
$('#wizardNext')?.addEventListener('click', () => {
  if (state.wizardStep === 1) {
    setWizardStep(2);
    generateProposal();
  } else if (state.wizardStep === 2) {
    if (state.wizardLoading) return;
    setWizardStep(3);
  } else {
    const project = createProjectFromWizard();
    closeModal();
    openProject(project.id);
    toast(`《${project.title}》已创建，开始写第一句话吧`);
  }
});
$('#wizardBack')?.addEventListener('click', () => {
  if (state.wizardStep === 2) setWizardStep(1);
  else if (state.wizardStep === 3) setWizardStep(2);
});

/* ---------- 搜索 ---------- */
$('#libSearch')?.addEventListener('input', filterLibraryProjects);
$('#codexSearch')?.addEventListener('input', (e) => filterCodex(e.target.value));

/* ---------- 键盘 ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    const activeLayer = (!$('#providerLayer')?.hidden && $('#providerLayer'))
      || (!$('#providerCatalogLayer')?.hidden && $('#providerCatalogLayer'))
      || (!$('#settingsOverlay')?.hidden && $('#settingsOverlay'));
    if (activeLayer) {
      const focusables = $$('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', activeLayer)
        .filter((el) => el.getClientRects().length > 0);
      if (focusables.length) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!activeLayer.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
          return;
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
          return;
        }
      }
    }
  }
  const overlay = $('#overlay');
  if (overlay && !overlay.hidden && e.key === 'Tab') {
    const modal = $$('.modal', overlay).find((m) => !m.hidden);
    if (modal) {
      const focusables = $$('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
        .filter((el) => el.offsetParent !== null);
      if (focusables.length) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!modal.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
          return;
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
          return;
        }
      }
    }
  }
  if (e.key === 'Escape') {
    if ($('#providerLayer') && !$('#providerLayer').hidden) {
      closeProviderPanel();
      return;
    }
    if ($('#providerCatalogLayer') && !$('#providerCatalogLayer').hidden) {
      closeProviderCatalog();
      return;
    }
    if ($('#settingsOverlay') && !$('#settingsOverlay').hidden) {
      closeSettings();
      return;
    }
    if (!$('#overlay').hidden) {
      closeModal();
      return;
    }
    const anyPopover = $$('.popover').some((pop) => !pop.hidden && pop.getClientRects().length > 0);
    if (anyPopover) {
      closeAllPopovers();
      return;
    }
    if ($('#annotationPop') && !$('#annotationPop').hidden) {
      $('#annotationPop').hidden = true;
      return;
    }
    if (state.focus) {
      toggleFocus(false);
      return;
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    focusLibrarySearch();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    syncEditor();
    toast('已保存到云端（原型演示）');
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '.') {
    e.preventDefault();
    toggleFocus();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === aiInput) {
    e.preventDefault();
    sendAIPrompt(aiInput.value);
  }
});

window.addEventListener('resize', closeAllPopovers);
$('#document')?.addEventListener('scroll', closeAllPopovers);

/* ---------- 设置中心交互 ---------- */
$('#editorSizeRange')?.addEventListener('input', (e) => {
  appearance.editorSize = Number(e.target.value) || 17.5;
  applyAppearance(false);
});
$('#editorSizeRange')?.addEventListener('change', () => applyAppearance(true));
$('#reduceMotionSwitch')?.addEventListener('click', () => {
  appearance.reduceMotion = !appearance.reduceMotion;
  applyAppearance(true);
});
$('#customAccent')?.addEventListener('input', (e) => {
  appearance.customAccent = e.target.value;
  applyAppearance(false);
});
$('#customAccent')?.addEventListener('change', () => applyAppearance(true));
$('#temperatureRange')?.addEventListener('input', (e) => {
  generationSettings.temperature = Number(e.target.value);
  const label = $('#temperatureValue');
  if (label) label.textContent = generationSettings.temperature.toFixed(1);
});
$('#temperatureRange')?.addEventListener('change', saveProviderSettings);
$('#streamingSwitch')?.addEventListener('click', () => {
  generationSettings.streaming = !generationSettings.streaming;
  syncGenerationUI();
  saveProviderSettings();
});
$('#prefAutoSave')?.addEventListener('click', () => {
  settingsPrefs.autoSave = !settingsPrefs.autoSave;
  syncWritingPrefs();
  savePrefs();
});
$('#prefPov')?.addEventListener('change', (e) => {
  settingsPrefs.pov = e.target.value;
  savePrefs();
});
$('#prefGenre')?.addEventListener('change', (e) => {
  settingsPrefs.genre = e.target.value;
  savePrefs();
});
$('#prefAiLength')?.addEventListener('change', (e) => {
  settingsPrefs.aiLength = e.target.value;
  savePrefs();
});
$('#stylePicker')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  settingsPrefs.style = btn.textContent.trim();
  syncWritingPrefs();
  savePrefs();
});
$('#defaultModelSelect')?.addEventListener('change', (e) => {
  const entry = modelEntryByKey(e.target.value);
  if (!entry) return;
  defaultModel = { providerId: entry.provider.id, modelId: entry.model.id };
  normalizeModelSelection();
  saveProviderSettings();
  renderProviders();
  renderModelPopover();
  updateModelPill();
  toast(`默认模型已切换为 ${entry.model.name}`);
});
$('#fallbackModelSelect')?.addEventListener('change', (e) => {
  const entry = modelEntryByKey(e.target.value);
  fallbackModel = entry ? { providerId: entry.provider.id, modelId: entry.model.id } : null;
  saveProviderSettings();
  toast(entry ? `备用模型：${entry.model.name}` : '已关闭备用模型');
});
$('#providerEnabledSwitch')?.addEventListener('click', () => {
  const sw = $('#providerEnabledSwitch');
  const on = !sw.classList.contains('is-on');
  sw.classList.toggle('is-on', on);
  sw.setAttribute('aria-checked', String(on));
});
$('#providerBase')?.addEventListener('input', (e) => {
  const label = $('#providerEndpointLabel');
  if (label) label.textContent = providerHost(e.target.value);
});
$('#providerCatalogSearch')?.addEventListener('input', (e) => {
  settingsState.catalogQuery = e.target.value;
  renderProviderCatalog();
});
$('#providerModelList')?.addEventListener('change', (e) => {
  const cb = e.target.closest('[data-provider-model]');
  if (!cb || !settingsState.draft) return;
  const id = cb.dataset.providerModel;
  if (cb.checked) {
    if (!settingsState.draft.enabledModels.includes(id)) settingsState.draft.enabledModels.push(id);
  } else {
    settingsState.draft.enabledModels = settingsState.draft.enabledModels.filter((x) => x !== id);
  }
  cb.closest('.provider-model-item')?.classList.toggle('is-enabled', cb.checked);
});

/* ---------- 首次渲染 ---------- */
initAppearance();
initProviders();
initPrefs();
updateStorageUsage();
hydrateAllWords();
renderCharacters();
renderEntities();
renderTimeline();
renderForeshadow();
renderChapter();
renderChapterTree();
renderChatForProject(projects.fog);
renderSceneTree();
renderScene('s12');
renderTopbar();
$('#panel').hidden = true;
$$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === 'library'));
$$('.rail-btn[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === 'library'));

// 专注模式退出按钮
const focusExit = document.createElement('button');
focusExit.type = 'button';
focusExit.className = 'btn btn--ghost btn--sm focus-exit';
focusExit.innerHTML = '<svg class="icon"><use href="#i-focus"></use></svg> 退出专注';
focusExit.addEventListener('click', () => toggleFocus(false));
$('#app').appendChild(focusExit);
