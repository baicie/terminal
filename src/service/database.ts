import Database from "@tauri-apps/plugin-sql";
import { isTauri } from "@tauri-apps/api/core";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    if (!isTauri()) {
      throw new Error("Database only available in Tauri context");
    }
    db = await Database.load("sqlite:terminal.db");
    await initSchema();
    await configureSqlite();
  }
  return db;
}

async function configureSqlite() {
  const database = db!;
  // Enable WAL mode for better concurrent access
  await database.execute("PRAGMA journal_mode=WAL");
  // Set busy timeout to wait for locks (5 seconds)
  await database.execute("PRAGMA busy_timeout=5000");
}

async function initSchema() {
  const database = db!;

  await database.execute(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hostname TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT DEFAULT 'password',
      password TEXT,
      private_key TEXT,
      group_id TEXT,
      is_favorite INTEGER DEFAULT 0,
      color TEXT,
      tags TEXT,
      port_forwards TEXT,
      startup_command TEXT,
      environment TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT,
      inherit_settings INTEGER DEFAULT 1,
      settings TEXT,
      "order" INTEGER DEFAULT 0
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      script TEXT NOT NULL,
      package_id TEXT,
      tags TEXT,
      variables TEXT
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS snippet_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS known_hosts (
      hostname TEXT PRIMARY KEY,
      fingerprint TEXT,
      added_at INTEGER
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS command_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id TEXT,
      command TEXT NOT NULL,
      executed_at INTEGER NOT NULL,
      session_id TEXT
    )
  `);

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_command_history_host_id ON command_history(host_id)
  `);

  await database.execute(`
    CREATE INDEX IF NOT EXISTS idx_command_history_executed_at ON command_history(executed_at DESC)
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      color TEXT,
      "order" INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS workspace_layouts (
      workspace_id TEXT PRIMARY KEY,
      layout_data TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
  `);
}

export async function executeQuery(sql: string, params: unknown[] = []) {
  const database = await getDb();
  return database.execute(sql, params);
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const database = await getDb();
  return database.select(sql, params);
}

// Command History Operations
export interface CommandHistoryRecord {
  id?: number;
  host_id: string;
  command: string;
  executed_at: number;
  session_id?: string;
}

export async function addCommandHistory(record: Omit<CommandHistoryRecord, "id">) {
  const database = await getDb();
  await database.execute(
    "INSERT INTO command_history (host_id, command, executed_at, session_id) VALUES (?, ?, ?, ?)",
    [record.host_id, record.command, record.executed_at, record.session_id || null]
  );
}

export async function getCommandHistory(hostId?: string, limit = 100): Promise<CommandHistoryRecord[]> {
  const database = await getDb();
  if (hostId) {
    return database.select(
      "SELECT * FROM command_history WHERE host_id = ? ORDER BY executed_at DESC LIMIT ?",
      [hostId, limit]
    );
  }
  return database.select(
    "SELECT * FROM command_history ORDER BY executed_at DESC LIMIT ?",
    [limit]
  );
}

export async function searchCommandHistory(query: string, limit = 20): Promise<CommandHistoryRecord[]> {
  const database = await getDb();
  return database.select(
    "SELECT * FROM command_history WHERE command LIKE ? ORDER BY executed_at DESC LIMIT ?",
    [`%${query}%`, limit]
  );
}

export async function clearCommandHistory(hostId?: string) {
  const database = await getDb();
  if (hostId) {
    await database.execute("DELETE FROM command_history WHERE host_id = ?", [hostId]);
  } else {
    await database.execute("DELETE FROM command_history");
  }
}

// Snippet Operations
export interface SnippetRecord {
  id: string;
  name: string;
  description?: string;
  script: string;
  package_id?: string;
  tags?: string;
  variables?: string;
}

export interface SnippetPackageRecord {
  id: string;
  name: string;
  description?: string;
}

export async function createSnippet(snippet: SnippetRecord) {
  const database = await getDb();
  await database.execute(
    "INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [snippet.id, snippet.name, snippet.description || null, snippet.script, snippet.package_id || null, snippet.tags || null, snippet.variables || null]
  );
}

export async function updateSnippet(snippet: SnippetRecord) {
  const database = await getDb();
  await database.execute(
    "UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?",
    [snippet.name, snippet.description || null, snippet.script, snippet.package_id || null, snippet.tags || null, snippet.variables || null, snippet.id]
  );
}

export async function deleteSnippet(id: string) {
  const database = await getDb();
  await database.execute("DELETE FROM snippets WHERE id = ?", [id]);
}

export async function getSnippets(packageId?: string): Promise<SnippetRecord[]> {
  const database = await getDb();
  if (packageId) {
    return database.select("SELECT * FROM snippets WHERE package_id = ? ORDER BY name", [packageId]);
  }
  return database.select("SELECT * FROM snippets ORDER BY name");
}

export async function getSnippetById(id: string): Promise<SnippetRecord | null> {
  const database = await getDb();
  const results = await database.select<SnippetRecord[]>("SELECT * FROM snippets WHERE id = ?", [id]);
  return results[0] || null;
}

export async function searchSnippets(query: string): Promise<SnippetRecord[]> {
  const database = await getDb();
  return database.select(
    "SELECT * FROM snippets WHERE name LIKE ? OR description LIKE ? OR script LIKE ? ORDER BY name LIMIT 50",
    [`%${query}%`, `%${query}%`, `%${query}%`]
  );
}

// Snippet Package Operations
export async function createSnippetPackage(pkg: SnippetPackageRecord) {
  const database = await getDb();
  await database.execute(
    "INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)",
    [pkg.id, pkg.name, pkg.description || null]
  );
}

export async function deleteSnippetPackage(id: string) {
  const database = await getDb();
  await database.execute("DELETE FROM snippet_packages WHERE id = ?", [id]);
}

export async function getSnippetPackages(): Promise<SnippetPackageRecord[]> {
  const database = await getDb();
  return database.select("SELECT * FROM snippet_packages ORDER BY name");
}

// Settings Operations
export interface AppSettings {
  theme: "light" | "dark" | "system";
  language: string;
  fontSize: number;
  fontFamily: string;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  scrollback: number;
  copyOnSelect: boolean;
  pasteOnMiddleClick: boolean;
  allowProposedApi: boolean;
}

const defaultSettings: AppSettings = {
  theme: "dark",
  language: "en",
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  pasteOnMiddleClick: true,
  allowProposedApi: true,
};

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const database = await getDb();
  const results = await database.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  if (results.length === 0) {
    return defaultValue;
  }
  try {
    return JSON.parse(results[0].value) as T;
  } catch {
    return defaultValue;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const database = await getDb();
  const jsonValue = JSON.stringify(value);
  await database.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [key, jsonValue]
  );
}

export async function getAppSettings(): Promise<AppSettings> {
  const settings = await getSetting("app_settings", defaultSettings);
  return { ...defaultSettings, ...settings };
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getAppSettings();
  const merged = { ...current, ...settings };
  await setSetting("app_settings", merged);
}

// Workspace Operations
export interface WorkspaceRecord {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  order: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export async function createWorkspace(workspace: WorkspaceRecord): Promise<void> {
  const database = await getDb();
  await database.execute(
    "INSERT INTO workspaces (id, name, description, icon, color, \"order\", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [workspace.id, workspace.name, workspace.description, workspace.icon, workspace.color, workspace.order, workspace.is_active, workspace.created_at, workspace.updated_at]
  );
}

export async function updateWorkspace(id: string, updates: Partial<WorkspaceRecord>): Promise<void> {
  const database = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.icon !== undefined) { fields.push("icon = ?"); values.push(updates.icon); }
  if (updates.color !== undefined) { fields.push("color = ?"); values.push(updates.color); }
  if (updates.order !== undefined) { fields.push("\"order\" = ?"); values.push(updates.order); }
  if (updates.is_active !== undefined) { fields.push("is_active = ?"); values.push(updates.is_active); }
  if (updates.updated_at !== undefined) { fields.push("updated_at = ?"); values.push(updates.updated_at); }

  if (fields.length > 0) {
    values.push(id);
    await database.execute(`UPDATE workspaces SET ${fields.join(", ")} WHERE id = ?`, values);
  }
}

export async function deleteWorkspace(id: string): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM workspaces WHERE id = ?", [id]);
}

export async function getWorkspaces(): Promise<WorkspaceRecord[]> {
  const database = await getDb();
  return database.select("SELECT * FROM workspaces ORDER BY \"order\"");
}

export async function getActiveWorkspace(): Promise<WorkspaceRecord | null> {
  const database = await getDb();
  const results = await database.select<WorkspaceRecord[]>(
    "SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1"
  );
  return results[0] || null;
}

export async function setActiveWorkspace(id: string): Promise<void> {
  const database = await getDb();
  // Deactivate all workspaces first
  await database.execute("UPDATE workspaces SET is_active = 0");
  // Activate the selected one
  await database.execute("UPDATE workspaces SET is_active = 1 WHERE id = ?", [id]);
}

// Workspace Layout Operations
export interface WorkspaceLayoutRecord {
  workspace_id: string;
  layout_data: string;  // JSON string of layout
}

export async function saveWorkspaceLayout(workspaceId: string, layoutData: unknown): Promise<void> {
  const database = await getDb();
  const jsonData = JSON.stringify(layoutData);
  await database.execute(
    "INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)",
    [workspaceId, jsonData]
  );
}

export async function getWorkspaceLayout(workspaceId: string): Promise<WorkspaceLayoutRecord | null> {
  const database = await getDb();
  const results = await database.select<WorkspaceLayoutRecord[]>(
    "SELECT * FROM workspace_layouts WHERE workspace_id = ?",
    [workspaceId]
  );
  return results[0] || null;
}
