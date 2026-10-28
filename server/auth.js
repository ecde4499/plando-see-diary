'use strict';

// T07 authentication module. This module is intentionally NOT mounted yet.
// Integration must protect every existing data route before public deployment.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = 'pds_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HASH_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const LOGIN_ERROR = '이메일 또는 비밀번호를 확인하세요.';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new Error('비밀번호는 12자 이상이어야 합니다.');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, HASH_PARAMS.keylen, {
    N: HASH_PARAMS.N, r: HASH_PARAMS.r, p: HASH_PARAMS.p, maxmem: 64 * 1024 * 1024
  });
  return ['scrypt', HASH_PARAMS.N, HASH_PARAMS.r, HASH_PARAMS.p,
    salt.toString('hex'), derived.toString('hex')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) return false;
    const [algorithm, n, r, p, saltHex, hashHex] = String(stored).split('$');
    if (algorithm !== 'scrypt' || Number(n) !== HASH_PARAMS.N ||
        Number(r) !== HASH_PARAMS.r || Number(p) !== HASH_PARAMS.p ||
        !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{128}$/.test(hashHex)) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: HASH_PARAMS.N, r: HASH_PARAMS.r, p: HASH_PARAMS.p, maxmem: 64 * 1024 * 1024
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch (_) { return false; }
}

function digestToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookie(header, name) {
  const item = String(header || '').split(';').map((x) => x.trim())
    .find((x) => x.startsWith(name + '='));
  return item ? item.slice(name.length + 1) : null;
}

function cookieOptions(req) {
  const secure = process.env.NODE_ENV === 'production';
  return { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: SESSION_TTL_MS };
}

async function issueSession(req, res, pool, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)',
    [userId, digestToken(token), new Date(Date.now() + SESSION_TTL_MS)]
  );
  res.cookie(COOKIE_NAME, token, cookieOptions(req));
}

function createAuthRouter(express, pool) {
  const router = express.Router();
  router.post('/register', async (req, res, next) => {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!validEmail(email) || typeof password !== 'string' || password.length < 12 ||
        Buffer.byteLength(password, 'utf8') > 1024) {
      return res.status(400).json({ error: '이메일과 12자 이상의 비밀번호를 확인하세요.' });
    }
    try {
      const passwordHash = await hashPassword(password);
      const result = await pool.query(
        'INSERT INTO app_users(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING RETURNING id,email',
        [email, passwordHash]
      );
      if (!result.rowCount) return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
      await issueSession(req, res, pool, result.rows[0].id);
      res.status(201).json({ user: result.rows[0] });
    } catch (error) { next(error); }
  });
  router.post('/login', async (req, res, next) => {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!validEmail(email) || typeof password !== 'string') {
      return res.status(401).json({ error: LOGIN_ERROR });
    }
    try {
      const result = await pool.query('SELECT id,email,password_hash FROM app_users WHERE email=$1', [email]);
      // Constant-work password check for unknown accounts.
      const fakeHash = await hashPassword('constant-dummy-password-never-used');
      const matched = await verifyPassword(password, result.rows[0]?.password_hash || fakeHash);
      if (!result.rowCount || !matched) return res.status(401).json({ error: LOGIN_ERROR });
      await issueSession(req, res, pool, result.rows[0].id);
      res.json({ user: { id: result.rows[0].id, email: result.rows[0].email } });
    } catch (error) { next(error); }
  });
  router.post('/logout', async (req, res, next) => {
    try {
      const token = parseCookie(req.headers.cookie, COOKIE_NAME);
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
          [digestToken(token)]);
      }
      res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.get('/me', requireAuth(pool), (req, res) => {
    res.json({ user: req.authUser });
  });
  return router;
}

function requireAuth(pool) {
  return async (req, res, next) => {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: '로그인이 필요합니다.' });
    try {
      const result = await pool.query(
        `SELECT u.id,u.email FROM auth_sessions s
         JOIN app_users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
           AND s.created_at>=u.password_changed_at`,
        [digestToken(token)]
      );
      if (!result.rowCount) return res.status(401).json({ error: '로그인이 필요합니다.' });
      req.authUser = result.rows[0];
      next();
    } catch (error) { next(error); }
  };
}

module.exports = { createAuthRouter, requireAuth, hashPassword, verifyPassword, normalizeEmail, digestToken };
