import { loadConfig } from '../server/config.mjs';
import { createPool } from '../server/db.mjs';
import { runOnce } from '../server/runner.mjs';

const config = loadConfig();
const pool = createPool(config);
if (!pool) {
  console.error('DATABASE_URL is required.');
  process.exitCode = 1;
} else {
  try {
    const result = await runOnce({ pool, config });
    console.log(result ? `Run ${result.id} finished with status ${result.status}.` : 'No queued run.');
  } catch (error) {
    console.error('Runner failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
