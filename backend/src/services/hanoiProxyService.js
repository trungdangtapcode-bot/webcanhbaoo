const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_PROXY_BASE_URL = 'http://127.0.0.1:5001';
const HANOI_PROXY_BASE_URL = process.env.HANOI_MJPEG_PROXY_BASE_URL || DEFAULT_PROXY_BASE_URL;
const AUTOSTART_ENABLED = !['0', 'false', 'off', 'disabled', 'none'].includes(
  String(process.env.HANOI_PROXY_AUTOSTART ?? 'true').toLowerCase()
);
const PROXY_SCRIPT = path.resolve(__dirname, '../../../ai_module/hanoi_wss_proxy.py');
const HEALTH_TIMEOUT_MS = Number(process.env.HANOI_PROXY_HEALTH_TIMEOUT_MS || 1200);

let proxyProcess = null;
let startAttemptedAt = 0;
let lastStartError = null;

function getProxyBaseUrl() {
  return HANOI_PROXY_BASE_URL.replace(/\/$/, '');
}

function getPythonCommand() {
  if (process.env.HANOI_PROXY_PYTHON) return process.env.HANOI_PROXY_PYTHON;

  const candidates = [
    process.env.PYTHON,
    path.resolve(__dirname, '../../venv/Scripts/python.exe'),
    path.resolve(__dirname, '../../venv/bin/python'),
    path.resolve(__dirname, '../../../ai_module/venv/Scripts/python.exe'),
    path.resolve(__dirname, '../../../ai_module/venv/bin/python'),
    'python',
    'python3',
  ].filter(Boolean);

  const existingCandidates = candidates.filter((candidate) =>
    candidate.includes(path.sep) ? fs.existsSync(candidate) : true
  );

  const runnable = existingCandidates.find(canRunHanoiProxy);
  if (runnable) return runnable;

  lastStartError =
    'No runnable Python environment can import flask, imageio_ffmpeg, and websockets. ' +
    'Install ai_module/requirements.txt or set HANOI_PROXY_PYTHON to a working interpreter.';
  return null;
}

function canRunHanoiProxy(pythonCommand) {
  try {
    const result = spawnSync(
      pythonCommand,
      ['-c', 'import flask, imageio_ffmpeg, websockets'],
      { stdio: 'ignore', windowsHide: true }
    );
    return result.status === 0;
  } catch (_err) {
    return false;
  }
}

async function checkProxyHealth() {
  try {
    const response = await fetch(`${getProxyBaseUrl()}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch (_err) {
    return false;
  }
}

function startProxy() {
  if (!AUTOSTART_ENABLED || proxyProcess || !fs.existsSync(PROXY_SCRIPT)) return;

  const now = Date.now();
  if (now - startAttemptedAt < 10000) return;
  startAttemptedAt = now;

  const python = getPythonCommand();
  if (!python) return;

  const env = {
    ...process.env,
    HANOI_PROXY_HOST: process.env.HANOI_PROXY_HOST || '127.0.0.1',
    HANOI_PROXY_PORT: process.env.HANOI_PROXY_PORT || '5001',
    HANOI_CAMERA_CACHE_FILE:
      process.env.HANOI_CAMERA_CACHE_FILE || path.resolve(__dirname, '../../hanoi_cameras.json'),
  };

  try {
    const child = spawn(python, [PROXY_SCRIPT], {
      cwd: path.dirname(PROXY_SCRIPT),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    proxyProcess = child;

    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[HanoiProxy] ${chunk}`);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[HanoiProxy] ${chunk}`);
    });
    child.on('error', (err) => {
      if (proxyProcess !== child) return;
      lastStartError = err.message;
      proxyProcess = null;
    });
    child.on('exit', (code, signal) => {
      if (proxyProcess !== child) return;
      if (code && code !== 0) lastStartError = `Proxy exited with code ${code}`;
      if (signal) lastStartError = `Proxy exited with signal ${signal}`;
      proxyProcess = null;
    });
  } catch (err) {
    lastStartError = err.message;
    proxyProcess = null;
  }
}

async function ensureHanoiProxyStarted() {
  if (await checkProxyHealth()) {
    lastStartError = null;
    return { available: true, autostarted: false };
  }

  startProxy();

  const deadline = Date.now() + Number(process.env.HANOI_PROXY_START_WAIT_MS || 4500);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await checkProxyHealth()) {
      lastStartError = null;
      return { available: true, autostarted: true };
    }
  }

  return {
    available: false,
    autostarted: Boolean(proxyProcess),
    error: lastStartError,
  };
}

function getHanoiProxyStatus() {
  return {
    autostart_enabled: AUTOSTART_ENABLED,
    base_url: getProxyBaseUrl(),
    process_running: Boolean(proxyProcess),
    script_exists: fs.existsSync(PROXY_SCRIPT),
    last_start_error: lastStartError,
  };
}

module.exports = {
  ensureHanoiProxyStarted,
  getHanoiProxyStatus,
  getProxyBaseUrl,
};
