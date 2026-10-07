// SQLite via node:sqlite — stable in the course's pinned Node (24.21.0), so
// the Docker image needs no native build toolchain for a database driver.
// /data is the only storage that survives a restart or redeploy (fly.toml's
// contract); CI mounts a throwaway tmpfs there, local dev falls back to
// ./.data so there's nothing to set up to run the server on a laptop.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function resolveDbPath(): string {
  const override = process.env.DB_PATH;
  if (override) return override;
  return existsSync("/data") ? "/data/app.db" : "./.data/app.db";
}

function migrate(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const appliedRows = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
  const applied = new Set(appliedRows.map((row) => row.name));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
}

let instance: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (instance) return instance;
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  instance = new DatabaseSync(path);
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA foreign_keys = ON;");
  migrate(instance);
  return instance;
}
