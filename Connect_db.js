// @ts-nocheck
const DB_STORAGE_KEY = "JASS_SQLITE_DB_V2";
const DB_PROFILE_FILE = "./Database/jass_profile.db";

let jassDbInstance = null;
let jassInitPromise = null;

function uint8ToBase64(uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function persistDatabase() {
  if (!jassDbInstance) return;
  try {
    const data = jassDbInstance.export();
    localStorage.setItem(DB_STORAGE_KEY, uint8ToBase64(data));
  } catch (err) {
    console.warn("Could not persist SQLite to localStorage:", err);
  }
}

function ensureCoreSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS Information (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      Names TEXT NOT NULL,
      Department TEXT NOT NULL,
      Skill TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS History (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL
    );
  `);

  const countRes = db.exec("SELECT COUNT(*) FROM Information;");
  const rowCount = countRes?.[0]?.values?.[0]?.[0] ?? 0;
  if (rowCount === 0) {
    db.run(
      "INSERT INTO Information (Names, Department, Skill) VALUES (?, ?, ?);",
      ["AARON JAMES JOSE", "MAIN/ADMIN", "EVERYTHING"]
    );
  }
}

async function initDatabase() {
  if (jassDbInstance) return jassDbInstance;
  if (jassInitPromise) return jassInitPromise;

  jassInitPromise = (async () => {
    if (typeof initSqlJs !== "function") {
      throw new Error("sql.js library failed to load.");
    }

    const SQL = await initSqlJs({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@1.16.0/dist/${file}`
    });

    let loadedDb = null;

    // 1. Try loading existing browser-persisted database
    const savedBase64 = localStorage.getItem(DB_STORAGE_KEY);
    if (savedBase64) {
      try {
        loadedDb = new SQL.Database(base64ToUint8(savedBase64));
        loadedDb.exec("SELECT name FROM sqlite_master LIMIT 1;");
      } catch (e) {
        console.warn("Resetting unreadable localStorage DB:", e);
        localStorage.removeItem(DB_STORAGE_KEY);
        loadedDb = null;
      }
    }

    // 2. Otherwise try loading ./Database/jass_profile.db if present
    if (!loadedDb) {
      try {
        const res = await fetch(`${DB_PROFILE_FILE}?v=${Date.now()}`);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const candidate = new SQL.Database(new Uint8Array(buf));
          candidate.exec("SELECT name FROM sqlite_master LIMIT 1;");
          loadedDb = candidate;
        }
      } catch (e) {
        console.warn("Bundled DB file skipped, creating fresh SQLite DB.");
      }
    }

    // 3. Create fresh SQLite database if none existed
    if (!loadedDb) {
      loadedDb = new SQL.Database();
    }

    ensureCoreSchema(loadedDb);
    jassDbInstance = loadedDb;
    persistDatabase();
    return jassDbInstance;
  })();

  return jassInitPromise;
}

async function queryDatabase(sql, params = []) {
  const db = await initDatabase();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

async function runDatabase(sql, params = []) {
  const db = await initDatabase();
  db.run(sql, params);
  persistDatabase();
}

async function getTables() {
  const rows = await queryDatabase(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
  );
  return rows.map((r) => r.name);
}

async function saveHistory(prompt, response) {
  const timestamp = new Date().toLocaleString();
  await runDatabase(
    "INSERT INTO History (timestamp, prompt, response) VALUES (?, ?, ?);",
    [timestamp, String(prompt), String(response)]
  );
}

async function getHistory(limit = 20) {
  return await queryDatabase(
    "SELECT id, timestamp, prompt, response FROM History ORDER BY id DESC LIMIT ?;",
    [limit]
  );
}

async function clearHistory() {
  await runDatabase("DELETE FROM History;");
}

async function exportDatabaseFile() {
  const db = await initDatabase();
  const binaryArray = db.export();
  const blob = new Blob([binaryArray], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "jass_profile.db";
  a.click();
  URL.revokeObjectURL(url);
  if (typeof logEvent === "function") logEvent("Exported jass_profile.db.");
}

window.initDatabase = initDatabase;
window.queryDatabase = queryDatabase;
window.runDatabase = runDatabase;
window.getTables = getTables;
window.saveHistory = saveHistory;
window.getHistory = getHistory;
window.clearHistory = clearHistory;
window.exportDatabaseFile = exportDatabaseFile;
