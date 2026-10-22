export type ProjectType = 'novel' | 'short' | 'screenplay' | 'series';

export type ThemeId = 'ink' | 'abyss' | 'moss' | 'paper';
export type AccentId = 'cinnabar' | 'jade' | 'amber' | 'indigo' | 'violet' | 'graphite';

export interface AppearanceSettings {
  theme: ThemeId;
  accent: AccentId;
  customAccent: string | null;
  editorSize: number;
  reduceMotion: boolean;
}

export interface WritingPrefs {
  pov: string;
  genre: string;
  aiLength: string;
  autoSave: boolean;
  style: string;
}

export interface GenerationSettings {
  temperature: number;
  streaming: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  ctx: string;
  tags: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  family: string;
  kind: 'openai' | 'anthropic' | 'google' | 'mock';
  mark: string;
  brand: string;
  baseUrl: string;
  configured: boolean;
  enabled: boolean;
  apiKeyMasked: string;
  models: ModelInfo[];
  enabledModels: string[];
  defaultModel: string;
  isDefault: boolean;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface ProfileSettings {
  name: string;
  signature: string;
}

export interface OnboardingSettings {
  completed: boolean;
}

export interface AppSettings {
  profile: ProfileSettings;
  onboarding: OnboardingSettings;
  appearance: AppearanceSettings;
  prefs: WritingPrefs;
  generation: GenerationSettings;
  defaultModel: ModelRef | null;
  fallbackModel: ModelRef | null;
}

export interface ProjectSummary {
  id: string;
  title: string;
  type: ProjectType;
  genre: string;
  description: string;
  cover: string;
  status: string;
  totalWords: number;
  goalWords: number;
  chapterCount: number;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  createdAt: string;
}

export interface Chapter {
  id: string;
  projectId: string;
  volume: string;
  number: string;
  title: string;
  content: string;
  status: string;
  sortOrder: number;
  words: number;
  updatedAt: string;
}

export interface CharacterRelation {
  name: string;
  rel: string;
  tension: string;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  role: string;
  age: string;
  avatar: string;
  tags: string[];
  quote: string;
  description: string;
  secret: string;
  relations: CharacterRelation[];
  sortOrder: number;
}

export interface OutlineAct {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  sortOrder: number;
}

export interface OutlineBeat {
  id: string;
  projectId: string;
  actId: string;
  chapterNo: number;
  title: string;
  summary: string;
  tags: string[];
  status: string;
  sortOrder: number;
}

export interface Scene {
  id: string;
  projectId: string;
  number: string;
  groupName: string;
  place: string;
  time: string;
  heading: string;
  content: string;
  status: string;
  sortOrder: number;
}

export interface Shot {
  id: string;
  projectId: string;
  sceneId: string;
  shotNo: string;
  shotType: string;
  camera: string;
  duration: string;
  description: string;
  notes: string;
  sortOrder: number;
}

export interface Foreshadow {
  id: string;
  projectId: string;
  name: string;
  planted: string;
  payoff: string;
  status: string;
}

export interface ProjectDetail extends Project {
  chapters: Chapter[];
  characters: Character[];
  outline: { acts: OutlineAct[]; beats: OutlineBeat[] };
  scenes: Scene[];
  shots: Shot[];
  foreshadows: Foreshadow[];
}

export interface ChatMessage {
  id: string;
  projectId: string;
  chapterId: string | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface BootstrapResponse {
  projects: ProjectSummary[];
  settings: AppSettings;
  providers: ProviderInfo[];
  projectCount: number;
}

export interface ChapterPatch {
  title?: string;
  content?: string;
  status?: string;
  volume?: string;
  number?: string;
}

export interface AiStreamRequest {
  projectId: string;
  chapterId: string | null;
  providerId?: string;
  modelId?: string;
  prompt: string;
  mode?: 'continue' | 'rewrite' | 'outline' | 'check';
  regenerate?: boolean;
}

export interface ApiError {
  error: string;
  detail?: string;
}

export interface PlannedBeat {
  chapterNo: number;
  title: string;
  summary: string;
  tags: string[];
}

export interface PlannedAct {
  title: string;
  summary: string;
  beats: PlannedBeat[];
}

export interface PlannedCharacter {
  name: string;
  role: string;
  age: string;
  tags: string[];
  quote: string;
  description: string;
  secret: string;
}

export interface ProjectPlan {
  acts: PlannedAct[];
  characters: PlannedCharacter[];
  chapter: { title: string; content: string };
}

export interface ChapterVersion {
  id: string;
  projectId: string;
  chapterId: string;
  source: string;
  title: string;
  content: string;
  words: number;
  createdAt: string;
}
