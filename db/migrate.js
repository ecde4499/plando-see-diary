require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL이 필요합니다. .env.example을 참고하세요.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('DB migration 완료');
  } catch (error) {
    console.error('DB migration 실패:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
