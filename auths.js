import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const TOKEN_SECRET = process.env.AUTH_SECRET || 'dev-only-change-in-vercel-env';

/**
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function signToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${sig}`;
}

/**
 * @param {string} token
 * @returns {Record<string, any> | null}
 */
export function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encodedPayload, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (!parsed.exp || Date.now() > parsed.exp) return null;
  return parsed;
}

/**
 * @param {any} req
 * @param {any} res
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const session = verifyToken(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session token' });
      }
      return res.status(200).json({
        user: {
          id: session.id,
          username: session.username,
          email: session.email,
          role: session.role
        }
      });
    }

    if (req.method === 'POST') {
      const { mode, email, password, username, role } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const rawPassword = String(password || '');

      if (!cleanEmail || rawPassword.length < 8) {
        return res
          .status(400)
          .json({ error: 'Valid email and password (min 8 chars) are required' });
      }

      if (mode === 'register') {
        const cleanUsername = String(username || cleanEmail.split('@')[0])
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 30);
        const allowedRoles = ['admin', 'analyst', 'viewer'];
        const safeRole = allowedRoles.includes(role) ? role : 'analyst';

        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
        if (existing.rows.length > 0) {
          return res.status(409).json({ error: 'Email is already registered' });
        }

        const passwordHash = hashPassword(rawPassword);
        const inserted = await pool.query(
          `INSERT INTO users (username, email, password_hash, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, username, email, role`,
          [cleanUsername || 'soc_user', cleanEmail, passwordHash, safeRole]
        );

        const user = inserted.rows[0];
        const token = signToken({
          ...user,
          exp: Date.now() + 1000 * 60 * 60 * 12
        });

        return res.status(201).json({ token, user });
      }

      const found = await pool.query(
        'SELECT id, username, email, password_hash, role FROM users WHERE email = $1',
        [cleanEmail]
      );

      if (found.rows.length === 0 || !verifyPassword(rawPassword, found.rows[0].password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = {
        id: found.rows[0].id,
        username: found.rows[0].username,
        email: found.rows[0].email,
        role: found.rows[0].role
      };
      const token = signToken({
        ...user,
        exp: Date.now() + 1000 * 60 * 60 * 12
      });

      return res.status(200).json({ token, user });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Auth API Error:', err);
    return res.status(500).json({ error: 'Authentication service error' });
  }
}
