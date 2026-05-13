/**
 * JingxuanAgent_Storage.js — SQLite 持久化存储层
 *
 * 会话持久化、工具调用记录、性能指标、配置存储
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class Storage {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this._ready = false;
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');

    this._migrate();
    this._ready = true;
    return this;
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        duration_ms INTEGER DEFAULT 0,
        is_error INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        tags TEXT DEFAULT '{}',
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name, recorded_at);

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_key ON knowledge(key);
      CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
    `);

    // 检查版本
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get();
    const currentVersion = row?.v || 0;
    if (currentVersion < 1) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
    }
  }

  // 会话

  createSession(id, metadata = {}) {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO sessions (id, metadata) VALUES (?, ?)');
    stmt.run(id, JSON.stringify(metadata));
    return id;
  }

  getSession(id) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  }

  updateSession(id, metadata) {
    this.db.prepare('UPDATE sessions SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(metadata), id);
  }

  deleteSession(id) {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(id);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  listSessions(limit = 20) {
    return this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit);
  }

  // 消息

  addMessage(sessionId, role, content, opts = {}) {
    const stmt = this.db.prepare(
      'INSERT INTO messages (session_id, role, content, tool_calls, tokens) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(sessionId, role, content, opts.toolCalls ? JSON.stringify(opts.toolCalls) : null, opts.tokens || 0);
    this.db.prepare('UPDATE sessions SET updated_at = datetime(\'now\') WHERE id = ?').run(sessionId);
    return result.lastInsertRowid;
  }

  getMessages(sessionId, limit = 50) {
    return this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(sessionId, limit);
  }

  getRecentMessages(sessionId, limit = 20) {
    return this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(sessionId, limit).reverse();
  }

  deleteSessionMessages(sessionId) {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  }

  // 工具调用

  recordToolCall(sessionId, toolName, input, output, durationMs, isError) {
    const stmt = this.db.prepare(
      'INSERT INTO tool_calls (session_id, tool_name, input, output, duration_ms, is_error) VALUES (?, ?, ?, ?, ?, ?)'
    );
    return stmt.run(sessionId, toolName,
      typeof input === 'string' ? input : JSON.stringify(input),
      typeof output === 'string' ? output : JSON.stringify(output),
      durationMs, isError ? 1 : 0
    ).lastInsertRowid;
  }

  getToolStats(sinceMinutes = 60) {
    const since = new Date(Date.now() - sinceMinutes * 60000).toISOString();
    const total = this.db.prepare('SELECT COUNT(*) as c FROM tool_calls WHERE created_at >= ?').get(since).c;
    const errors = this.db.prepare('SELECT COUNT(*) as c FROM tool_calls WHERE is_error = 1 AND created_at >= ?').get(since).c;
    const byName = this.db.prepare(
      'SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration FROM tool_calls WHERE created_at >= ? GROUP BY tool_name ORDER BY count DESC'
    ).all(since);
    return { total, errors, errorRate: total > 0 ? (errors / total * 100).toFixed(1) + '%' : '0%', byName };
  }

  // 指标

  recordMetric(name, value, tags = {}) {
    this.db.prepare('INSERT INTO metrics (name, value, tags) VALUES (?, ?, ?)').run(name, value, JSON.stringify(tags));
  }

  getMetrics(name, sinceMinutes = 60) {
    const since = new Date(Date.now() - sinceMinutes * 60000).toISOString();
    return this.db.prepare(
      'SELECT value, tags, recorded_at FROM metrics WHERE name = ? AND recorded_at >= ? ORDER BY recorded_at ASC'
    ).all(name, since);
  }

  // 配置

  setConfig(key, value) {
    this.db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
    ).run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  getConfig(key, defaultValue = null) {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  getAllConfig() {
    const rows = this.db.prepare('SELECT key, value FROM config ORDER BY key').all();
    const result = {};
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
    }
    return result;
  }

  deleteConfig(key) {
    this.db.prepare('DELETE FROM config WHERE key = ?').run(key);
  }

  // 知识

  setKnowledge(key, value, category = 'general') {
    this.db.prepare(
      'INSERT INTO knowledge (key, value, category, updated_at) VALUES (?, ?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category, updated_at = datetime(\'now\')'
    ).run(key, value, category);
  }

  getKnowledge(key) {
    return this.db.prepare('SELECT * FROM knowledge WHERE key = ?').get(key);
  }

  searchKnowledge(query, category = null) {
    let sql = 'SELECT * FROM knowledge WHERE (key LIKE ? OR value LIKE ?)';
    const params = [`%${query}%`, `%${query}%`];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    return this.db.prepare(sql + ' ORDER BY updated_at DESC LIMIT 20').all(...params);
  }

  deleteKnowledge(key) {
    this.db.prepare('DELETE FROM knowledge WHERE key = ?').run(key);
  }

  // 维护

  vacuum() {
    this.db.exec('VACUUM');
  }

  backup(targetPath) {
    this.db.backup(targetPath);
  }

  getSize() {
    try {
      const stat = fs.statSync(this.dbPath);
      return stat.size;
    } catch { return 0; }
  }

  close() {
    if (this.db) {
      this.db.close();
      this._ready = false;
    }
  }

  getStats() {
    return {
      path: this.dbPath,
      size: this.getSize(),
      ready: this._ready,
      tables: {
        sessions: this.db.prepare('SELECT COUNT(*) as c FROM sessions').get().c,
        messages: this.db.prepare('SELECT COUNT(*) as c FROM messages').get().c,
        toolCalls: this.db.prepare('SELECT COUNT(*) as c FROM tool_calls').get().c,
        config: this.db.prepare('SELECT COUNT(*) as c FROM config').get().c,
        knowledge: this.db.prepare('SELECT COUNT(*) as c FROM knowledge').get().c,
      },
    };
  }
}

module.exports = Storage;
