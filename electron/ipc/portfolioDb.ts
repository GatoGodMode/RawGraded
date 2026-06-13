import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type { StudioPortfolioCard } from '../shared/studioPortfolioTypes';
import type { PortfolioListParams } from '../shared/portfolioBridgeTypes';
import { canonicalizePricechartingUrl } from '../shared/pricechartingCanonical';

let db: Database.Database | null = null;

function getDbPath(): string {
  const dir = path.join(app.getPath('userData'), 'studio-portfolio');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'portfolio.db');
}

function openDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      doc_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      set_name TEXT NOT NULL DEFAULT '',
      card_number TEXT NOT NULL DEFAULT '',
      raw REAL,
      tcg_market REAL,
      tcg_condition TEXT,
      norm_pc_url TEXT,
      norm_tcg_url TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      last_refreshed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
    CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_name);
    CREATE INDEX IF NOT EXISTS idx_cards_archived ON cards(is_archived);
    CREATE INDEX IF NOT EXISTS idx_cards_updated ON cards(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cards_pc ON cards(norm_pc_url);
  `);
  return db;
}

function rowToCard(row: { payload_json: string }): StudioPortfolioCard {
  return JSON.parse(row.payload_json) as StudioPortfolioCard;
}

function indexFromCard(card: StudioPortfolioCard): {
  name: string;
  set_name: string;
  card_number: string;
  raw: number | null;
  tcg_market: number | null;
  tcg_condition: string | null;
  norm_pc_url: string | null;
  norm_tcg_url: string | null;
  is_archived: number;
  last_refreshed_at: number | null;
} {
  const normPc = card.pricechartingUrl ? canonicalizePricechartingUrl(card.pricechartingUrl) : null;
  const normTcg = card.tcgplayerUrl?.trim() || null;
  return {
    name: card.name || '',
    set_name: card.set || '',
    card_number: card.cardNumber || '',
    raw: card.raw ?? null,
    tcg_market: card.tcgMarket ?? null,
    tcg_condition: card.tcgCondition ?? null,
    norm_pc_url: normPc,
    norm_tcg_url: normTcg,
    is_archived: card.isArchived ? 1 : 0,
    last_refreshed_at: card.lastRefreshedAt ?? null,
  };
}

export function upsertPortfolioCard(card: StudioPortfolioCard): StudioPortfolioCard {
  const database = openDb();
  const idx = indexFromCard(card);
  const payload = JSON.stringify(card);
  database
    .prepare(
      `INSERT INTO cards (
        id, updated_at, payload_json, name, set_name, card_number, raw, tcg_market,
        tcg_condition, norm_pc_url, norm_tcg_url, is_archived, last_refreshed_at
      ) VALUES (
        @id, @updated_at, @payload_json, @name, @set_name, @card_number, @raw, @tcg_market,
        @tcg_condition, @norm_pc_url, @norm_tcg_url, @is_archived, @last_refreshed_at
      )
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json,
        name = excluded.name,
        set_name = excluded.set_name,
        card_number = excluded.card_number,
        raw = excluded.raw,
        tcg_market = excluded.tcg_market,
        tcg_condition = excluded.tcg_condition,
        norm_pc_url = excluded.norm_pc_url,
        norm_tcg_url = excluded.norm_tcg_url,
        is_archived = excluded.is_archived,
        last_refreshed_at = excluded.last_refreshed_at`
    )
    .run({
      id: card.id,
      updated_at: card.updatedAt,
      payload_json: payload,
      ...idx,
    });
  return card;
}

export function getPortfolioCard(id: string): StudioPortfolioCard | null {
  const database = openDb();
  const row = database.prepare('SELECT payload_json FROM cards WHERE id = ?').get(id) as
    | { payload_json: string }
    | undefined;
  return row ? rowToCard(row) : null;
}

export function deletePortfolioCard(id: string): boolean {
  const database = openDb();
  const r = database.prepare('DELETE FROM cards WHERE id = ?').run(id);
  return r.changes > 0;
}

export function listPortfolioCards(params: PortfolioListParams): { items: StudioPortfolioCard[]; total: number } {
  const database = openDb();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const includeArchived = params.includeArchived ?? false;
  const search = (params.search || '').trim().toLowerCase();

  let where = includeArchived ? 'is_archived = 1' : 'is_archived = 0';
  const args: unknown[] = [];
  if (search) {
    where += ' AND (lower(name) LIKE ? OR lower(set_name) LIKE ? OR lower(card_number) LIKE ?)';
    const q = `%${search}%`;
    args.push(q, q, q);
  }

  const sort = params.sort || 'updated';
  let orderBy = 'updated_at DESC';
  if (sort === 'name') orderBy = 'lower(name) ASC';
  if (sort === 'raw') orderBy = 'raw IS NULL, raw DESC';

  const totalRow = database
    .prepare(`SELECT COUNT(*) AS c FROM cards WHERE ${where}`)
    .get(...args) as { c: number };

  const rows = database
    .prepare(`SELECT payload_json FROM cards WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Array<{ payload_json: string }>;

  return { items: rows.map(rowToCard), total: totalRow.c };
}

export function listStaleCardIds(maxAgeMs: number): string[] {
  const database = openDb();
  const cutoff = Date.now() - maxAgeMs;
  const rows = database
    .prepare(
      `SELECT id FROM cards WHERE is_archived = 0 AND (last_refreshed_at IS NULL OR last_refreshed_at < ?)`
    )
    .all(cutoff) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function getPortfolioDbPath(): string {
  return getDbPath();
}
