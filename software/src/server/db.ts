import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { seedDatabase } from './seed.ts';
import { countWords, now, uid } from './utils.ts';

const dataDir = process.env.PW_DATA_DIR ? path.resolve(process.env.PW_DATA_DIR) : path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const dbPath = path.join(dataDir, 'studio.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      genre TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT 'fog',
      status TEXT NOT NULL DEFAULT '创作中',
      total_words INTEGER NOT NULL DEFAULT 0,
      goal_words INTEGER NOT NULL DEFAULT 300000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      volume TEXT NOT NULL DEFAULT '',
      number TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '草稿',
      sort_order INTEGER NOT NULL DEFAULT 0,
      words INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, sort_order);

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      age TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      quote TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      secret TEXT NOT NULL DEFAULT '',
      relations TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id, sort_order);

    CREATE TABLE IF NOT EXISTS outline_acts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS outline_beats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      act_id TEXT NOT NULL REFERENCES outline_acts(id) ON DELETE CASCADE,
      chapter_no INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT '待写',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_beats_project ON outline_beats(project_id, sort_order);

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      number TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      time TEXT NOT NULL DEFAULT '',
      heading TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '草稿',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id, sort_order);

    CREATE TABLE IF NOT EXISTS chapter_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT '手动',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      words INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_versions_chapter ON chapter_versions(chapter_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      shot_no TEXT NOT NULL DEFAULT '',
      shot_type TEXT NOT NULL DEFAULT '',
      camera TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_shots_scene ON shots(scene_id, sort_order);

    CREATE TABLE IF NOT EXISTS foreshadows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      planted TEXT NOT NULL DEFAULT '',
      payoff TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '待回收',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      family TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'openai',
      mark TEXT NOT NULL DEFAULT '?',
      brand TEXT NOT NULL DEFAULT '#888888',
      base_url TEXT NOT NULL DEFAULT '',
      api_key_enc TEXT,
      models TEXT NOT NULL DEFAULT '[]',
      enabled_models TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_project ON ai_messages(project_id, created_at);
  `);

  const row = db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number };
  if (!row || row.count === 0) {
    seedDatabase(db);
    console.log('[db] seeded demo data');
  }
}

export { countWords, now, uid } from './utils.ts';
