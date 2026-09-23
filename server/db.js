require('dotenv').config();
const { Pool, types } = require('pg');

// PostgreSQL DATE는 시간대 변환 없이 YYYY-MM-DD 문자열 그대로 유지한다.
types.setTypeParser(1082, (value) => value);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 환경 변수가 없습니다.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

module.exports = { pool };
