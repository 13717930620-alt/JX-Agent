/**
 * DocumentAutomation — 文档自动化服务
 *
 * 在 DocumentParser 基础上提供:
 *   - 批量文档处理
 *   - 文档对比分析
 *   - 结构化报告生成
 *   - 跨文档搜索
 */
const path = require('path');
const fs = require('fs');

class DocumentAutomation {
    constructor(options = {}) {
        const DocumentParser = require('./JingxuanAgent_Implementation/atomic_executor/DocumentParser');
        this.parser = new DocumentParser({
            maxFileSize: options.maxFileSize || 50 * 1024 * 1024,
            maxTextLength: options.maxTextLength || 100000,
        });
        this.outputDir = options.outputDir || path.join(process.cwd(), 'reports');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * 解析单个文件
     */
    async parse(filePath) {
        return this.parser.parse(filePath);
    }

    /**
     * 批量解析多个文件
     * @param {string[]} filePaths - 文件路径数组
     * @param {object} options
     * @param {boolean} options.continueOnError - 单个文件失败是否继续
     * @returns {Promise<{results: Array, errors: Array}>}
     */
    async parseBatch(filePaths, options = {}) {
        const results = [];
        const errors = [];

        for (const fp of filePaths) {
            try {
                const result = await this.parser.parse(fp);
                results.push({ filePath: fp, ...result });
            } catch (e) {
                errors.push({ filePath: fp, error: e.message });
                if (!options.continueOnError) break;
            }
        }

        return { results, errors };
    }

    /**
     * 按目录批量解析（支持递归）
     * @param {string} dirPath - 目录路径
     * @param {object} options
     * @param {string[]} options.extensions - 筛选扩展名，如 ['.pdf', '.docx']
     * @param {boolean} options.recursive - 是否递归子目录
     */
    async parseDirectory(dirPath, options = {}) {
        const extensions = options.extensions || ['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.txt', '.md', '.jpg', '.png'];
        const recursive = options.recursive !== false;

        const files = this._scanFiles(dirPath, extensions, recursive);
        if (files.length === 0) {
            return { results: [], errors: [], summary: { total: 0, message: `在 ${dirPath} 中未找到匹配的文档` } };
        }

        const { results, errors } = await this.parseBatch(files, options);
        return {
            results,
            errors,
            summary: this._generateBatchSummary(results, errors, dirPath),
        };
    }

    /**
     * 搜索文档内容
     * @param {string} filePath - 文档路径
     * @param {string|RegExp} keyword - 搜索关键词或正则
     * @returns {Promise<{matches: Array, count: number}>}
     */
    async searchInDocument(filePath, keyword) {
        const parsed = await this.parser.parse(filePath);
        const text = parsed.content || '';
        const lines = text.split('\n');
        const matches = [];
        const pattern = typeof keyword === 'string' ? new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : keyword;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (pattern.test(line)) {
                matches.push({
                    lineNumber: i + 1,
                    text: line.substring(0, 200).trim(),
                });
                pattern.lastIndex = 0; // reset for global regex
            }
        }

        return { matches, count: matches.length };
    }

    /**
     * 对比两份文档
     * @param {string} filePathA - 文档 A
     * @param {string} filePathB - 文档 B
     * @returns {Promise<object>} 对比结果
     */
    async compare(filePathA, filePathB) {
        const [docA, docB] = await Promise.all([
            this.parser.parse(filePathA),
            this.parser.parse(filePathB),
        ]);

        const textA = docA.content || '';
        const textB = docB.content || '';

        // 基础统计对比
        const stats = {
            a: { fileName: path.basename(filePathA), charCount: textA.length, wordCount: textA.split(/\s+/).length },
            b: { fileName: path.basename(filePathB), charCount: textB.length, wordCount: textB.split(/\s+/).length },
        };

        // 行级差异 (简单 LCS)
        const linesA = textA.split('\n');
        const linesB = textB.split('\n');
        const diffs = this._computeDiff(linesA, linesB);

        const ratio = textA.length > 0
            ? (1 - this._levenshteinRatio(textA.substring(0, 10000), textB.substring(0, 10000)))
            : 0;

        return {
            type: 'comparison',
            files: { a: filePathA, b: filePathB },
            stats,
            similarity: {
                ratio: ratio.toFixed(3),
                percentage: (ratio * 100).toFixed(1) + '%',
                description: ratio > 0.8 ? '高度相似' : ratio > 0.5 ? '部分相似' : '差异较大',
            },
            diffs: {
                added: diffs.filter(d => d.type === 'add').length,
                removed: diffs.filter(d => d.type === 'remove').length,
                unchanged: diffs.filter(d => d.type === 'same').length,
                details: diffs.slice(0, 50), // 最多输出50处差异
            },
            metadata: {
                a: docA.metadata || {},
                b: docB.metadata || {},
            },
        };
    }

    /**
     * 生成结构化分析报告
     * @param {string} filePath - 文档路径
     * @param {object} options
     * @returns {Promise<{report: string, savePath?: string}>}
     */
    async generateReport(filePath, options = {}) {
        const parsed = await this.parser.parse(filePath);
        const text = parsed.content || '';
        const fileName = path.basename(filePath);

        const lines = [
            `========================================`,
            `  文档分析报告`,
            `========================================`,
            ``,
            `文件: ${fileName}`,
            `类型: ${parsed.type || '未知'}`,
            `大小: ${parsed.metadata?.fileSize ? (parsed.metadata.fileSize / 1024).toFixed(1) + ' KB' : '未知'}`,
            `解析时间: ${new Date().toLocaleString()}`,
            ``,
            `--- 内容统计 ---`,
            `总字符数: ${text.length}`,
            `总行数: ${text.split('\n').length}`,
            `总词数: ${text.split(/\s+/).filter(Boolean).length}`,
            ``,
        ];

        if (parsed.metadata?.pages) lines.push(`页数: ${parsed.metadata.pages}`);
        if (parsed.metadata?.author) lines.push(`作者: ${parsed.metadata.author}`);
        if (parsed.metadata?.title) lines.push(`标题: ${parsed.metadata.title}`);

        // 关键词提取 (高频词)
        const keywords = this._extractKeywords(text, 10);
        if (keywords.length > 0) {
            lines.push(``);
            lines.push(`--- 高频关键词 ---`);
            for (const [word, count] of keywords) {
                lines.push(`  ${word}: ${count}次`);
            }
        }

        // 段落结构
        const paragraphs = text.split('\n\n').filter(p => p.trim().length > 20);
        lines.push(``);
        lines.push(`--- 段落结构 ---`);
        lines.push(`总段落数: ${paragraphs.length}`);
        for (let i = 0; i < Math.min(paragraphs.length, 20); i++) {
            const p = paragraphs[i].trim().substring(0, 100).replace(/\n/g, ' ');
            lines.push(`  [${i + 1}] ${p}...`);
        }

        lines.push(``);
        lines.push(`========================================`);

        const report = lines.join('\n');

        // 可选保存到文件
        let savePath = null;
        if (options.save) {
            const reportName = `${path.basename(filePath, path.extname(filePath))}_报告_${Date.now()}.txt`;
            savePath = path.join(this.outputDir, reportName);
            fs.writeFileSync(savePath, report, 'utf-8');
        }

        return { report, savePath };
    }

    /**
     * 批量生成报告
     */
    async generateBatchReports(filePaths, options = {}) {
        const reports = [];
        for (const fp of filePaths) {
            try {
                const r = await this.generateReport(fp, options);
                reports.push({ filePath: fp, ...r });
            } catch (e) {
                reports.push({ filePath: fp, error: e.message });
            }
        }
        return reports;
    }

    // ========== 内部方法 ==========

    _scanFiles(dirPath, extensions, recursive) {
        const results = [];
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory() && recursive) {
                    results.push(...this._scanFiles(fullPath, extensions, recursive));
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (extensions.includes(ext)) {
                        results.push(fullPath);
                    }
                }
            }
        } catch (e) {
            // 跳过无法读取的目录
        }
        return results;
    }

    _generateBatchSummary(results, errors, dirPath) {
        const typeCount = {};
        for (const r of results) {
            const t = r.type || 'unknown';
            typeCount[t] = (typeCount[t] || 0) + 1;
        }
        return {
            total: results.length + errors.length,
            success: results.length,
            failed: errors.length,
            directory: dirPath,
            types: typeCount,
            message: `处理完成: ${results.length} 成功, ${errors.length} 失败`,
        };
    }

    _computeDiff(linesA, linesB) {
        const result = [];
        const maxLen = Math.max(linesA.length, linesB.length);
        for (let i = 0; i < maxLen; i++) {
            if (i >= linesA.length) {
                result.push({ type: 'add', line: i + 1, text: linesB[i].substring(0, 200) });
            } else if (i >= linesB.length) {
                result.push({ type: 'remove', line: i + 1, text: linesA[i].substring(0, 200) });
            } else if (linesA[i] !== linesB[i]) {
                result.push({ type: 'remove', line: i + 1, text: linesA[i].substring(0, 200) });
                result.push({ type: 'add', line: i + 1, text: linesB[i].substring(0, 200) });
            } else {
                result.push({ type: 'same', line: i + 1, text: linesA[i].substring(0, 100) });
            }
        }
        return result;
    }

    _levenshteinRatio(a, b) {
        const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
        for (let j = 1; j <= b.length; j++) {
            let prev = dp[0];
            dp[0] = j;
            for (let i = 1; i <= a.length; i++) {
                const temp = dp[i];
                dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
                prev = temp;
            }
        }
        return dp[a.length] / Math.max(a.length, b.length, 1);
    }

    _extractKeywords(text, topN) {
        // 简单中文+英文高频词提取
        const stopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
            '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己',
            '这', '他', '她', '它', '们', '那', '些', '为', '以', '能', '之', '跟', '但', '被', '把',
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
            'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
            'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my',
            'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'us', 'them',
            'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into', 'through', 'of',
            'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then', 'than', 'also', 'very', 'just']);

        const words = text.split(/[\s,，。；;：:、！!？?（）()【】\[\]""''""''\n\r]+/);
        const freq = new Map();
        for (const w of words) {
            const word = w.trim().toLowerCase();
            if (!word || word.length < 2 || stopWords.has(word) || /^\d+$/.test(word)) continue;
            freq.set(word, (freq.get(word) || 0) + 1);
        }

        return [...freq.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, topN);
    }
}

module.exports = DocumentAutomation;
