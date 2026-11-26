const AUTH_ENDPOINT = '/api/auth';
const SECURITY_ENDPOINT = '/api/security';
const TOKEN_STORAGE_KEY = 'aegis_soc_token';

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_REGEX = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$/;

const state = {
  token: localStorage.getItem(TOKEN_STORAGE_KEY) || '',
  user: null,
  authMode: 'login',
  controls: {
    waf_firewall: true,
    auto_ip_block: true,
    session_purge: true,
    threat_alerts: true
  },
  metrics: {
    threatsNeutralized: 0,
    blockedIpsCount: 0,
    purgedSessions: 0
  },
  logs: [],
  blockedIps: []
};

function isValidIp(ip) {
  return IPV4_REGEX.test(ip.trim()) || IPV6_REGEX.test(ip.trim());
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.token}`
  };
}

// Chart.js Telemetry Setup
const ctx = document.getElementById('trafficChart').getContext('2d');
const trafficChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: ['10s ago', '8s ago', '6s ago', '4s ago', '2s ago', 'Now'],
    datasets: [
      {
        label: 'Observed Traffic / min',
        data: [120, 128, 124, 136, 132, 140],
        borderColor: '#0369a1',
        backgroundColor: 'rgba(224, 242, 254, 0.55)',
        fill: true,
        tension: 0.35
      },
      {
        label: 'Flagged Anomalies',
        data: [1, 2, 0, 3, 1, 1],
        borderColor: '#b91c1c',
        backgroundColor: 'rgba(254, 226, 226, 0.4)',
        fill: true,
        tension: 0.35
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      y: { beginAtZero: true, grid: { color: '#ebe4e0' } },
      x: { grid: { display: false } }
    }
  }
});

// UI State & Role Permissions
function setAuthModalVisible(visible) {
  const modal = document.getElementById('authModal');
  modal.classList.toggle('hidden', !visible);
}

function applyRolePermissions() {
  const role = state.user?.role || 'viewer';
  const canToggleControls = role === 'admin';
  const canMutateSecurity = role === 'admin' || role === 'analyst';

  document.querySelectorAll('[data-control]').forEach((input) => {
    input.disabled = !canToggleControls;
  });

  document.getElementById('simulateAttackBtn').disabled = !canMutateSecurity;
  document.getElementById('purgeSessionsBtn').disabled = !canMutateSecurity;
  document.querySelector('#manualBlockForm button[type="submit"]').disabled = !canMutateSecurity;
  document.getElementById('roleHint').textContent = canToggleControls
    ? 'Admin access enabled'
    : `Role: ${role.toUpperCase()}`;

  document.getElementById('sessionUserLabel').textContent = state.user
    ? `${state.user.username} (${role})`
    : 'Not authenticated';
}

function updateKpis() {
  document.getElementById('kpiFirewall').textContent = state.controls.waf_firewall
    ? 'ENFORCED'
    : 'BYPASSED';
  document.getElementById('kpiThreats').textContent = state.metrics.threatsNeutralized;
  document.getElementById('kpiBlockedIps').textContent = state.metrics.blockedIpsCount;
  document.getElementById('kpiPurged').textContent = state.metrics.purgedSessions;
}

function renderControls() {
  Object.entries(state.controls).forEach(([key, enabled]) => {
    const checkbox = document.querySelector(`[data-control="${key}"]`);
    if (checkbox) checkbox.checked = Boolean(enabled);
  });
  updateKpis();
}

function renderBlockedIps() {
  const list = document.getElementById('blockedIpList');
  list.innerHTML = '';

  if (state.blockedIps.length === 0) {
    list.innerHTML = '<li><span class="muted-text">No blocked IPs in registry.</span></li>';
    return;
  }

  state.blockedIps.slice(0, 12).forEach((entry) => {
    const li = document.createElement('li');
    const badgeText = entry.auto_blocked ? 'AUTO-BANNED' : 'MANUAL BAN';
    li.innerHTML = `
      <div>
        <strong>${entry.ip_address}</strong>
        <div class="muted-text">${entry.reason}</div>
      </div>
      <span class="tag tag-high">${badgeText}</span>
    `;
    list.appendChild(li);
  });
}

function renderLogs() {
  const tbody = document.getElementById('logTableBody');
  const query = document.getElementById('logSearchInput').value.trim().toLowerCase();
  const severity = document.getElementById('severityFilter').value;

  const filtered = state.logs.filter((row) => {
    const matchesSeverity = severity === 'ALL' || row.severity === severity;
    const matchesQuery =
      !query ||
      row.event_type.toLowerCase().includes(query) ||
      row.source_ip.toLowerCase().includes(query) ||
      row.action_taken.toLowerCase().includes(query);
    return matchesSeverity && matchesQuery;
  });

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="muted-text">No matching security events found.</td></tr>';
    return;
  }

  filtered.slice(0, 25).forEach((row) => {
    const tr = document.createElement('tr');
    const timeLabel = row.created_at
      ? new Date(row.created_at).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    const sevClass =
      row.severity === 'HIGH' || row.severity === 'CRITICAL'
        ? 'tag-high'
        : row.severity === 'MEDIUM'
        ? 'tag-medium'
        : 'tag-low';

    tr.innerHTML = `
      <td>${timeLabel}</td>
      <td><strong>${row.event_type}</strong></td>
      <td><code>${row.source_ip}</code></td>
      <td><span class="tag ${sevClass}">${row.severity}</span></td>
      <td><span class="tag tag-ok">${row.action_taken}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Backend API Calls
async function loadDashboardState() {
  if (!state.token) {
    setAuthModalVisible(true);
    return;
  }

  const res = await fetch(SECURITY_ENDPOINT, {
    headers: getAuthHeaders()
  });

  if (res.status === 401) {
    logout();
    return;
  }

  if (!res.ok) {
    throw new Error('Failed to load security state');
  }

  const data = await res.json();
  state.logs = data.logs || [];
  state.blockedIps = data.blockedIps || [];
  state.metrics = data.metrics || state.metrics;

  if (Array.isArray(data.controls)) {
    data.controls.forEach((ctrl) => {
      state.controls[ctrl.control_key] = Boolean(ctrl.is_enabled);
    });
  }

  renderControls();
  renderBlockedIps();
  renderLogs();
  applyRolePermissions();
}

async function postSecurityAction(action, payload) {
  if (!state.token) return null;

  const res = await fetch(SECURITY_ENDPOINT, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action, payload })
  });

  if (res.status === 401) {
    logout();
    return null;
  }

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Security action rejected');
  }

  return body;
}

// Auth Handlers
function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === 'register';
  document.getElementById('tabLogin').classList.toggle('active', !isRegister);
  document.getElementById('tabRegister').classList.toggle('active', isRegister);
  document.getElementById('usernameField').style.display = isRegister ? 'flex' : 'none';
  document.getElementById('roleField').style.display = isRegister ? 'flex' : 'none';
  document.getElementById('authSubmitBtn').textContent = isRegister
    ? 'Create Account & Sign In'
    : 'Continue to Dashboard';
  document.getElementById('authError').textContent = '';
}

function logout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  setAuthModalVisible(true);
  applyRolePermissions();
}

document.getElementById('tabLogin').addEventListener('click', () => setAuthMode('login'));
document.getElementById('tabRegister').addEventListener('click', () => setAuthMode('register'));
document.getElementById('logoutBtn').addEventListener('click', logout);

document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('authError');
  errorEl.textContent = '';

  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const username = document.getElementById('authUsername').value.trim();
  const role = document.getElementById('authRole').value;

  try {
    const res = await fetch(AUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: state.authMode,
        email,
        password,
        username,
        role
      })
    });

    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Authentication failed';
      return;
    }

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    setAuthModalVisible(false);
    await loadDashboardState();
  } catch (err) {
    errorEl.textContent = err.message || 'Network error during authentication';
  }
});

// Automated Threat Detection & Session Purge Routines
function generateRandomPublicIp() {
  return `${Math.floor(Math.random() * 190) + 20}.${Math.floor(Math.random() * 255)}.${Math.floor(
    Math.random() * 255
  )}.${Math.floor(Math.random() * 250) + 1}`;
}

async function runTelemetryCycle(simulateSpike = false) {
  if (!state.token) return;

  const baseRequests = Math.floor(Math.random() * 35) + 115;
  const anomalies = simulateSpike
    ? Math.floor(Math.random() * 10) + 6
    : Math.floor(Math.random() * 3);

  trafficChart.data.labels.shift();
  trafficChart.data.labels.push(new Date().toLocaleTimeString([], { hour12: false }));
  trafficChart.data.datasets[0].data.shift();
  trafficChart.data.datasets[0].data.push(baseRequests);
  trafficChart.data.datasets[1].data.shift();
  trafficChart.data.datasets[1].data.push(anomalies);
  trafficChart.update('none');

  const role = state.user?.role;
  const canMutate = role === 'admin' || role === 'analyst';

  if (canMutate && (simulateSpike || anomalies >= 2)) {
    const scenarios = [
      { event_type: 'BRUTE_FORCE_AUTH', severity: 'HIGH', reason: 'Repeated failed login probes' },
      { event_type: 'SQL_INJECTION_ATTEMPT', severity: 'CRITICAL', reason: 'Malicious query pattern' },
      { event_type: 'INVALID_SESSION_TOKEN', severity: 'MEDIUM', reason: 'Unauthorized session replay' }
    ];
    const pick = scenarios[Math.floor(Math.random() * scenarios.length)];
    const sourceIp = generateRandomPublicIp();

    let actionTaken = 'LOGGED_ONLY';
    if (state.controls.waf_firewall) {
      actionTaken = 'WAF_BLOCKED';
    }
    if (state.controls.auto_ip_block && (pick.severity === 'HIGH' || pick.severity === 'CRITICAL')) {
      await postSecurityAction('BLOCK_IP', {
        ip_address: sourceIp,
        reason: pick.reason,
        auto_blocked: true
      });
      actionTaken = 'AUTO_IP_BANNED';
    }

    await postSecurityAction('LOG_EVENT', {
      event_type: pick.event_type,
      severity: pick.severity,
      source_ip: sourceIp,
      action_taken: actionTaken
    });

    if (state.controls.session_purge && pick.event_type === 'INVALID_SESSION_TOKEN') {
      await postSecurityAction('PURGE_SESSIONS', {
        source_ip: sourceIp,
        revoked_count: 1
      });
    }

    await loadDashboardState();
  }
}

// Interactive Controls & Form Listeners
document.querySelectorAll('[data-control]').forEach((checkbox) => {
  checkbox.addEventListener('change', async (e) => {
    const key = e.target.dataset.control;
    const nextValue = e.target.checked;
    try {
      await postSecurityAction('TOGGLE_CONTROL', {
        control_key: key,
        is_enabled: nextValue
      });
      await loadDashboardState();
    } catch (err) {
      e.target.checked = !nextValue;
      alert(err.message);
    }
  });
});

document.getElementById('manualBlockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('ipFormError');
  errorEl.textContent = '';

  const ipInput = document.getElementById('ipInput');
  const reasonInput = document.getElementById('ipReasonInput');
  const ip = ipInput.value.trim();
  const reason = reasonInput.value.trim() || 'Manual SOC denylist entry';

  if (!isValidIp(ip)) {
    errorEl.textContent = 'Enter a valid IPv4 or IPv6 address.';
    return;
  }

  try {
    await postSecurityAction('BLOCK_IP', {
      ip_address: ip,
      reason,
      auto_blocked: false
    });
    await postSecurityAction('LOG_EVENT', {
      event_type: 'MANUAL_IP_BLOCK',
      severity: 'HIGH',
      source_ip: ip,
      action_taken: 'ADDED_TO_BLOCKLIST'
    });
    ipInput.value = '';
    reasonInput.value = '';
    await loadDashboardState();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('simulateAttackBtn').addEventListener('click', () => runTelemetryCycle(true));
document.getElementById('purgeSessionsBtn').addEventListener('click', async () => {
  try {
    await postSecurityAction('PURGE_SESSIONS', {
      source_ip: '10.0.0.1',
      revoked_count: 2
    });
    await loadDashboardState();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('refreshLogsBtn').addEventListener('click', loadDashboardState);
document.getElementById('logSearchInput').addEventListener('input', renderLogs);
document.getElementById('severityFilter').addEventListener('change', renderLogs);

// Initialization
(async function init() {
  if (!state.token) {
    setAuthModalVisible(true);
    return;
  }

  try {
    const meRes = await fetch(AUTH_ENDPOINT, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (meRes.ok) {
      const meData = await meRes.json();
      state.user = meData.user;
      setAuthModalVisible(false);
      await loadDashboardState();
    } else {
      logout();
    }
  } catch {
    setAuthModalVisible(true);
  }
})();

setInterval(() => runTelemetryCycle(false), 4000);
