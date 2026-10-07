import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createPool } from './db.mjs';

const config = loadConfig();
const pool = createPool(config);
if (!pool) {
  console.error('DATABASE_URL is required.');
  process.exitCode = 1;
} else {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
    const files = (await fs.readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const file of files) {
      const sql = await fs.readFile(path.join(root, file), 'utf8');
      await pool.query(sql);
      console.log(`Applied ${file}`);
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
