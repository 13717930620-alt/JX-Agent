/**
 * MetricsCollector — collects latency, success rate, and resource usage metrics.
 */
class MetricsCollector {
    constructor(options = {}) {
        this.interval = options.interval || 60000; // 1分钟
        this.windowSize = options.windowSize || 3600; // 1小时窗口
        
        this.counters = new Map();   // 计数器
        this.histograms = new Map(); // 直方图
        this.gauges = new Map();     // 瞬时值
        this.timeSeries = new Map(); // 时序数据
        
        this.startTime = Date.now();
        this._startAutoCollection();
    }

    /**
     * [计数] 递增计数器
     * @param {string} name 指标名
     * @param {number} value 增量值
     */
    increment(name, value = 1) {
        const counter = this.counters.get(name) || { total: 0, lastMinute: 0, history: [] };
        counter.total += value;
        counter.lastMinute += value;
        
        // 记录历史
        counter.history.push({ time: Date.now(), value });
        this._trimHistory(counter.history);
        
        this.counters.set(name, counter);
    }

    /**
     * [记录延迟] 记录操作延迟
     * @param {string} name 指标名
     * @param {number} durationMs 延迟毫秒
     */
    recordLatency(name, durationMs) {
        const hist = this.histograms.get(name) || { values: [], history: [] };
        hist.values.push(durationMs);
        hist.history.push({ time: Date.now(), value: durationMs });
        
        this._trimHistory(hist.history);
        this._trimArray(hist.values, 1000);
        
        // 计算统计
        hist.stats = this._calculateStats(hist.values);
        
        this.histograms.set(name, hist);
    }

    /**
     * [设置] 设置瞬时值
     * @param {string} name 指标名
     * @param {number} value 值
     */
    gauge(name, value) {
        const gauge = {
            value,
            timestamp: new Date().toISOString()
        };
        this.gauges.set(name, gauge);
        
        // 记录时序
        if (!this.timeSeries.has(name)) {
            this.timeSeries.set(name, []);
        }
        this.timeSeries.get(name).push(gauge);
        this._trimHistory(this.timeSeries.get(name));
    }

    /**
     * [获取指标] 获取指标快照
     * @param {string} name 指标名
     */
    get(name) {
        return {
            counter: this.counters.get(name),
            histogram: this.histograms.get(name)?.stats,
            gauge: this.gauges.get(name),
            timeSeries: this.timeSeries.get(name)?.slice(-60)
        };
    }

    /**
     * [获取全部] 获取所有指标
     */
    getAll() {
        const result = {
            uptime: Date.now() - this.startTime,
            timestamp: new Date().toISOString(),
            counters: {},
            histograms: {},
            gauges: {}
        };

        for (const [name, counter] of this.counters) {
            result.counters[name] = { total: counter.total, lastMinute: counter.lastMinute };
        }
        for (const [name, hist] of this.histograms) {
            result.histograms[name] = hist.stats;
        }
        for (const [name, gauge] of this.gauges) {
            result.gauges[name] = gauge.value;
        }

        return result;
    }

    /**
     * [重置] 重置所有指标
     */
    reset() {
        this.counters.clear();
        this.histograms.clear();
        this.gauges.clear();
        this.timeSeries.clear();
        this.startTime = Date.now();
    }

    // ============ 私有方法 ============

    _calculateStats(values) {
        if (values.length === 0) return null;
        
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        
        return {
            count: values.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: (sum / values.length).toFixed(2),
            p50: this._percentile(sorted, 50),
            p90: this._percentile(sorted, 90),
            p95: this._percentile(sorted, 95),
            p99: this._percentile(sorted, 99)
        };
    }

    _percentile(sorted, p) {
        const idx = Math.ceil(sorted.length * p / 100) - 1;
        return sorted[Math.max(0, idx)];
    }

    _trimHistory(arr) {
        while (arr.length > this.windowSize) {
            arr.shift();
        }
    }

    _trimArray(arr, maxSize) {
        while (arr.length > maxSize) {
            arr.shift();
        }
    }

    _startAutoCollection() {
        this._intervalId = setInterval(() => {
            // 重置 lastMinute 计数器
            for (const counter of this.counters.values()) {
                counter.lastMinute = 0;
            }
        }, this.interval);
    }

    destroy() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
}

module.exports = MetricsCollector;