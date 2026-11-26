const net = require('net');
const { Pool } = require('pg');
const { verifyToken } = require('./auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const ALLOWED_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const ALLOWED_CONTROLS = new Set([
  'waf_firewall',
  'auto_ip_block',
  'session_purge',
  'threat_alerts'
]);

function isValidIp(ip) {
  return typeof ip === 'string' && net.isIP(ip.trim()) !== 0;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const session = verifyToken(token);

  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (req.method === 'GET') {
      const [logsRes, ipsRes, controlsRes, countsRes] = await Promise.all([
        pool.query('SELECT * FROM security_logs ORDER BY created_at DESC LIMIT 50'),
        pool.query('SELECT * FROM blocked_ips ORDER BY blocked_at DESC LIMIT 50'),
        pool.query('SELECT * FROM security_controls ORDER BY control_key ASC'),
        pool.query(`
          SELECT
            (SELECT COUNT(*)::int FROM security_logs WHERE action_taken != 'LOGGED_ONLY') AS threats_neutralized,
            (SELECT COUNT(*)::int FROM blocked_ips) AS blocked_ips_count,
            (SELECT COUNT(*)::int FROM security_logs WHERE event_type = 'SESSION_AUTO_PURGE') AS purged_sessions
        `)
      ]);

      const counts = countsRes.rows[0] || {
        threats_neutralized: 0,
        blocked_ips_count: 0,
        purged_sessions: 0
      };

      return res.status(200).json({
        logs: logsRes.rows,
        blockedIps: ipsRes.rows,
        controls: controlsRes.rows,
        metrics: {
          threatsNeutralized: counts.threats_neutralized,
          blockedIpsCount: counts.blocked_ips_count,
          purgedSessions: counts.purged_sessions
        }
      });
    }

    if (req.method === 'POST') {
      if (session.role === 'viewer') {
        return res.status(403).json({ error: 'Viewer role cannot modify security state' });
      }

      const { action, payload = {} } = req.body || {};

      switch (action) {
        case 'LOG_EVENT': {
          const eventType = String(payload.event_type || 'SECURITY_EVENT')
            .trim()
            .replace(/[^A-Z0-9_]/gi, '_')
            .toUpperCase()
            .slice(0, 50);
          const severity = ALLOWED_SEVERITIES.has(payload.severity) ? payload.severity : 'MEDIUM';
          const sourceIp = isValidIp(payload.source_ip) ? payload.source_ip.trim() : '127.0.0.1';
          const actionTaken = String(payload.action_taken || 'LOGGED')
            .trim()
            .slice(0, 100);

          await pool.query(
            `INSERT INTO security_logs (event_type, severity, source_ip, action_taken)
             VALUES ($1, $2, $3, $4)`,
            [eventType, severity, sourceIp, actionTaken]
          );
          return res.status(201).json({ status: 'logged' });
        }

        case 'PURGE_SESSIONS': {
          const sourceIp = isValidIp(payload.source_ip) ? payload.source_ip.trim() : '127.0.0.1';
          const revokedCount = Math.max(1, Math.min(50, Number(payload.revoked_count) || 1));

          await pool.query(
            `INSERT INTO security_logs (event_type, severity, source_ip, action_taken)
             VALUES ($1, $2, $3, $4)`,
            ['SESSION_AUTO_PURGE', 'MEDIUM', sourceIp, `REVOKED_${revokedCount}_SESSIONS`]
          );
          return res.status(201).json({ status: 'sessions_purged', revokedCount });
        }

        case 'BLOCK_IP': {
          const ipAddress = String(payload.ip_address || '').trim();
          if (!isValidIp(ipAddress)) {
            return res.status(400).json({ error: 'Invalid IPv4 or IPv6 address format' });
          }

          const reason = String(payload.reason || 'Policy violation').trim().slice(0, 200);
          const autoBlocked = Boolean(payload.auto_blocked);

          await pool.query(
            `INSERT INTO blocked_ips (ip_address, reason, auto_blocked)
             VALUES ($1, $2, $3)
             ON CONFLICT (ip_address)
             DO UPDATE SET reason = EXCLUDED.reason, auto_blocked = EXCLUDED.auto_blocked`,
            [ipAddress, reason, autoBlocked]
          );
          return res.status(201).json({ status: 'ip_blocked', ip_address: ipAddress });
        }

        case 'TOGGLE_CONTROL': {
          if (session.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin users can toggle defense controls' });
          }

          const controlKey = String(payload.control_key || '').trim();
          if (!ALLOWED_CONTROLS.has(controlKey)) {
            return res.status(400).json({ error: 'Unknown control key' });
          }

          const isEnabled = Boolean(payload.is_enabled);
          await pool.query(
            `UPDATE security_controls
             SET is_enabled = $1, updated_at = CURRENT_TIMESTAMP
             WHERE control_key = $2`,
            [isEnabled, controlKey]
          );
          return res.status(200).json({ status: 'control_updated', control_key: controlKey, is_enabled: isEnabled });
        }

        default:
          return res.status(400).json({ error: 'Unsupported action' });
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Security API Error:', err);
    return res.status(500).json({ error: 'Internal security engine error' });
  }
};
