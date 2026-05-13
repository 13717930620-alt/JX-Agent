/**
 * HyperAgent_Infra.js — 基础设施层
 *
 * 结构化日志、断路器、重试、指标收集、健康检查
 */

// 结构化日志

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

class Logger {
  constructor(name = 'HyperAgent', level = 'info') {
    this.name = name;
    this.level = LOG_LEVELS[level] ?? 1;
    this.history = [];
    this.maxHistory = 1000;
  }

  _log(level, msg, meta = {}) {
    if (LOG_LEVELS[level] < this.level) return;
    const entry = {
      t: new Date().toISOString(),
      level,
      name: this.name,
      msg,
      ...meta,
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history.shift();

    const prefix = `[${entry.t.slice(11, 19)}][${level.toUpperCase()}]`;
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    if (level === 'error' || level === 'fatal') {
      console.error(`${prefix} ${msg}${metaStr}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${msg}${metaStr}`);
    } else {
      console.log(`${prefix} ${msg}${metaStr}`);
    }
  }

  debug(msg, meta) { this._log('debug', msg, meta); }
  info(msg, meta) { this._log('info', msg, meta); }
  warn(msg, meta) { this._log('warn', msg, meta); }
  error(msg, meta) { this._log('error', msg, meta); }
  fatal(msg, meta) { this._log('fatal', msg, meta); }

  child(name) { return new Logger(`${this.name}:${name}`, Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === this.level)); }

  getRecent(level = 'debug', n = 50) {
    const minLevel = LOG_LEVELS[level] ?? 0;
    return this.history.filter(e => LOG_LEVELS[e.level] >= minLevel).slice(-n);
  }

  setLevel(level) { this.level = LOG_LEVELS[level] ?? 1; }
}

// 断路器

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.maxFailures = options.maxFailures || 5;
    this.resetTimeout = options.resetTimeout || 30000;
    this.halfOpenMax = options.halfOpenMax || 1;
    this.state = 'closed'; // closed | open | half-open
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.halfOpenSuccesses = 0;
    this.log = new Logger(`cb:${name}`);
  }

  async call(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.lastStateChange > this.resetTimeout) {
        this._transition('half-open');
      } else {
        const err = new Error(`Circuit breaker ${this.name} is OPEN`);
        err.code = 'CB_OPEN';
        throw err;
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    this.successCount++;
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenMax) {
        this._transition('closed');
      }
    }
  }

  _onFailure(err) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'half-open') {
      this._transition('open');
    } else if (this.failureCount >= this.maxFailures) {
      this._transition('open');
    }
  }

  _transition(newState) {
    this.state = newState;
    this.lastStateChange = Date.now();
    if (newState === 'closed') {
      this.failureCount = 0;
      this.halfOpenSuccesses = 0;
    }
    this.log.warn(`Circuit ${this.name} -> ${newState} (failures=${this.failureCount})`);
  }

  getStatus() {
    return { name: this.name, state: this.state, failures: this.failureCount, successes: this.successCount, lastFailure: this.lastFailureTime };
  }
}

// 重试（指数退避 + 抖动）

async function retry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 15000;
  const retryOn = options.retryOn ?? ((err) => true);

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries) break;
      if (!retryOn(err)) break;

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await new Promise(r => setTimeout(r, jitter));
    }
  }
  throw lastErr;
}

// 指标收集器

class Metrics {
  constructor() {
    this.counters = {};
    this.gauges = {};
    this.histograms = {};
    this._startTime = Date.now();
  }

  increment(name, delta = 1) {
    this.counters[name] = (this.counters[name] || 0) + delta;
  }

  gauge(name, value) {
    this.gauges[name] = value;
  }

  timing(name, durationMs) {
    if (!this.histograms[name]) this.histograms[name] = [];
    this.histograms[name].push(durationMs);
    if (this.histograms[name].length > 1000) this.histograms[name].shift();
  }

  getCounter(name) { return this.counters[name] || 0; }

  snapshot() {
    const histoSummary = {};
    for (const [k, vals] of Object.entries(this.histograms)) {
      if (vals.length === 0) continue;
      const sorted = [...vals].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      histoSummary[k] = {
        min: sorted[0], max: sorted[sorted.length - 1],
        avg: Math.round(sum / sorted.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        count: sorted.length,
      };
    }
    return {
      uptime: Date.now() - this._startTime,
      counters: { ...this.counters },
      gauges: { ...this.gauges },
      histograms: histoSummary,
    };
  }
}

// 健康检查

class HealthCheck {
  constructor() {
    this._checks = new Map();
    this._status = 'starting'; // starting | healthy | degraded | down
  }

  register(name, checkFn, opts = {}) {
    this._checks.set(name, { fn: checkFn, interval: opts.interval || 30000, timeout: opts.timeout || 5000, lastCheck: 0, lastOk: true, lastError: null });
  }

  async runCheck(name) {
    const check = this._checks.get(name);
    if (!check) return { name, ok: false, error: 'Unknown check' };
    try {
      const result = await Promise.race([
        check.fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), check.timeout)),
      ]);
      check.lastCheck = Date.now();
      check.lastOk = true;
      check.lastError = null;
      return { name, ok: true, ...(result ? { data: result } : {}) };
    } catch (err) {
      check.lastCheck = Date.now();
      check.lastOk = false;
      check.lastError = err.message;
      return { name, ok: false, error: err.message };
    }
  }

  async runAll() {
    const results = [];
    for (const [name] of this._checks) {
      results.push(await this.runCheck(name));
    }
    const okCount = results.filter(r => r.ok).length;
    this._status = okCount === results.length ? 'healthy' : okCount > 0 ? 'degraded' : 'down';
    return { status: this._status, checks: results, timestamp: new Date().toISOString() };
  }

  getStatus() {
    const results = [];
    for (const [name, check] of this._checks) {
      results.push({ name, ok: check.lastOk, lastCheck: check.lastCheck, lastError: check.lastError });
    }
    return { status: this._status, checks: results };
  }
}

// 限速器（滑动窗口）

class RateLimiter {
  constructor(maxPerMinute = 60) {
    this.maxPerMinute = maxPerMinute;
    this.window = [];
  }

  async acquire() {
    const now = Date.now();
    this.window = this.window.filter(t => now - t < 60000);
    if (this.window.length >= this.maxPerMinute) {
      const wait = this.window[0] + 60000 - now;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    this.window.push(Date.now());
  }

  get utilization() {
    this.window = this.window.filter(t => Date.now() - t < 60000);
    return this.window.length / this.maxPerMinute;
  }
}

// 导出

module.exports = {
  Logger,
  CircuitBreaker,
  retry,
  Metrics,
  HealthCheck,
  RateLimiter,
  LOG_LEVELS,
};
