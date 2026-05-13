// PatternLibrary — 模式库

const fs = require('fs');
const path = require('path');

class PatternLibrary {
    constructor(options = {}) {
        this.storageDir = options.storageDir || path.join(process.cwd(), 'experience_store');
        this.debug = options.debug || false;

        // 模式存储
        this._patterns = new Map();   // patternKey → Pattern

        // 配置
        this.config = {
            minConfidenceToStore: options.minConfidence || 0.4,  // 入库最低自信度
            promotionThreshold: options.promotionThreshold || 0.7, // 提升为"可靠"的阈值
            archiveAfterDays: options.archiveAfterDays || 30,     // 未命中后归档
            maxPatterns: options.maxPatterns || 500               // 最大存储数
        };

        this.stats = {
            totalPatterns: 0,
            reliablePatterns: 0,
            tentativePatterns: 0,
            archivedPatterns: 0,
            totalHits: 0,
            lastAccess: null
        };
    }

    // 公共接口

    /**
     * 从 PatternDetector 结果中注册模式
     */
    registerFromDetector(detectionResults) {
        let added = 0;
        for (const patterns of Object.values(detectionResults)) {
            for (const pattern of patterns) {
                if (pattern.confidence >= this.config.minConfidenceToStore) {
                    this._register(pattern);
                    added++;
                }
            }
        }
        if (added > 0) this._updateStats();
        return added;
    }

    register(pattern) {
        this._register(pattern);
        this._updateStats();
    }

    /**
     * 匹配当前情境，返回相关模式
     * @param {object} situation
     * @param {object} [options]
     * @returns {object[]} 按置信度排序的匹配模式
     */
    matchSituation(situation, options = {}) {
        const matches = [];
        const sitStr = JSON.stringify(situation).toLowerCase();
        const currentHour = new Date().getHours();
        const currentDay = new Date().getDay();

        for (const [key, pattern] of this._patterns) {
            if (pattern.status === 'archived') continue;
            let score = 0;

            // 时序匹配
            if (pattern.subtype === 'hourly_pattern' && pattern.hour === currentHour) score += 0.6;
            if (pattern.subtype === 'weekly_pattern' && pattern.day === currentDay) score += 0.3;

            // 关键词匹配
            if (pattern.description) {
                const desc = pattern.description.toLowerCase();
                if (sitStr.includes(desc.substring(0, 10))) score += 0.4;
            }

            // 标签匹配
            const sitTags = situation.tags || [];
            if (pattern.tags && sitTags.some(t => pattern.tags.includes(t))) score += 0.3;

            if (score > 0.2) {
                matches.push({
                    ...pattern,
                    matchScore: score,
                    reliability: this._calculateReliability(pattern)
                });
                pattern.hitCount = (pattern.hitCount || 0) + 1;
                pattern.lastHit = new Date().toISOString();
                this.stats.totalHits++;
            }
        }

        return matches.sort((a, b) => (b.matchScore * b.reliability) - (a.matchScore * a.reliability));
    }

    getReliablePatterns(minReliability = 0.6) {
        const results = [];
        for (const pattern of this._patterns.values()) {
            if (pattern.status === 'archived') continue;
            const reliability = this._calculateReliability(pattern);
            if (reliability >= minReliability) {
                results.push({ ...pattern, reliability });
            }
        }
        return results.sort((a, b) => b.reliability - a.reliability);
    }

    getAll() {
        return Array.from(this._patterns.values());
    }

    getByType(type) {
        return Array.from(this._patterns.values())
            .filter(p => p.type === type && p.status !== 'archived');
    }

    getStats() {
        return {
            ...this.stats,
            byType: this._countByType(),
            statusDistribution: this._countByStatus(),
            avgConfidence: this._avgConfidence()
        };
    }

    persist() {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }
            const data = {
                exportedAt: new Date().toISOString(),
                patterns: Array.from(this._patterns.values()),
                stats: this.stats
            };
            const filePath = path.join(this.storageDir, 'pattern_library.json');
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[PatternLibrary] Persist error:', e.message);
            return false;
        }
    }

    load() {
        try {
            const filePath = path.join(this.storageDir, 'pattern_library.json');
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (data.patterns) {
                    for (const p of data.patterns) {
                        this._patterns.set(this._patternKey(p), p);
                    }
                }
                this.stats = { ...this.stats, ...(data.stats || {}) };
                this._updateStats();
                console.log(`[PatternLibrary] Loaded: ${this._patterns.size} patterns`);
                return true;
            }
        } catch (e) {
            console.warn('[PatternLibrary] Load error:', e.message);
        }
        return false;
    }

    reset() {
        this._patterns.clear();
        this.stats = { totalPatterns: 0, reliablePatterns: 0, tentativePatterns: 0, archivedPatterns: 0, totalHits: 0, lastAccess: null };
    }

    // 内部方法

    _register(pattern) {
        const key = this._patternKey(pattern);
        const existing = this._patterns.get(key);

        if (existing) {
            // 更新已有的模式
            existing.hitCount = (existing.hitCount || 0) + 1;
            existing.confidence = (existing.confidence + pattern.confidence) / 2;
            existing.lastSeen = new Date().toISOString();
            existing.updatedAt = new Date().toISOString();
            return existing;
        }

        if (this._patterns.size >= this.config.maxPatterns) {
            this._archiveOld();
        }

        pattern.key = key;
        pattern.status = 'tentative';  // tentative / reliable / archived
        pattern.hitCount = 0;
        pattern.firstSeen = pattern.detectedAt || new Date().toISOString();
        pattern.lastSeen = new Date().toISOString();
        pattern.createdAt = new Date().toISOString();
        pattern.updatedAt = new Date().toISOString();
        pattern.tags = pattern.tags || this._extractTags(pattern);

        this._patterns.set(key, pattern);
        return pattern;
    }

    _patternKey(pattern) {
        return `${pattern.type}_${pattern.subtype}_${(pattern.description || pattern.field || pattern.hour || '').substring(0, 40)}`;
    }

    _calculateReliability(pattern) {
        if (!pattern) return 0;
        if (pattern.status === 'archived') return 0;

        // 基于自信度、命中次数和新旧程度
        const confidenceScore = pattern.confidence || 0.3;
        const hitScore = Math.min(0.3, (pattern.hitCount || 0) * 0.05);
        const agePenalty = pattern.firstSeen ? 0 : 0.1; // 新发现的加分

        const reliability = confidenceScore * 0.5 + hitScore * 0.3 + agePenalty * 0.2;

        // 自动升级/降级
        if (reliability >= this.config.promotionThreshold && pattern.status === 'tentative') {
            pattern.status = 'reliable';
        }

        return Math.min(1, reliability);
    }

    _extractTags(pattern) {
        const tags = [];
        if (pattern.hour !== undefined) tags.push(`hour_${pattern.hour}`);
        if (pattern.day !== undefined) tags.push(`day_${pattern.day}`);
        if (pattern.subtype) tags.push(pattern.subtype);
        if (pattern.type) tags.push(pattern.type);
        if (pattern.field) tags.push(`field_${pattern.field}`);
        if (pattern.severity) tags.push(pattern.severity);
        return tags;
    }

    _archiveOld() {
        const now = Date.now();
        const archiveBefore = now - (this.config.archiveAfterDays * 86400000);

        for (const [key, pattern] of this._patterns) {
            const lastHit = pattern.lastHit ? new Date(pattern.lastHit).getTime() : 0;
            if (lastHit > 0 && lastHit < archiveBefore && pattern.status !== 'reliable') {
                pattern.status = 'archived';
                this.stats.archivedPatterns++;
            }
        }

        // 如果还是太多，移除归档的
        let archived = 0;
        for (const [key, pattern] of this._patterns) {
            if (pattern.status === 'archived') {
                this._patterns.delete(key);
                archived++;
                if (this._patterns.size <= this.config.maxPatterns * 0.8) break;
            }
        }
        if (archived > 0 && this.debug) {
            console.log(`[PatternLibrary] Purged ${archived} archived patterns`);
        }
    }

    _updateStats() {
        let reliable = 0, tentative = 0, archived = 0;
        for (const p of this._patterns.values()) {
            if (p.status === 'reliable') reliable++;
            else if (p.status === 'archived') archived++;
            else tentative++;
        }
        this.stats.totalPatterns = this._patterns.size;
        this.stats.reliablePatterns = reliable;
        this.stats.tentativePatterns = tentative;
        this.stats.archivedPatterns = archived;
        this.stats.lastAccess = new Date().toISOString();
    }

    _countByType() {
        const counts = {};
        for (const p of this._patterns.values()) {
            if (p.status !== 'archived') {
                counts[p.type] = (counts[p.type] || 0) + 1;
            }
        }
        return counts;
    }

    _countByStatus() {
        return {
            reliable: this.stats.reliablePatterns,
            tentative: this.stats.tentativePatterns,
            archived: this.stats.archivedPatterns
        };
    }

    _avgConfidence() {
        if (this._patterns.size === 0) return 0;
        let sum = 0, count = 0;
        for (const p of this._patterns.values()) {
            if (p.status !== 'archived') {
                sum += p.confidence || 0;
                count++;
            }
        }
        return count > 0 ? sum / count : 0;
    }
}

module.exports = PatternLibrary;
