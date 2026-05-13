/**
 * DocumentParser.js — 文档与图片解析工具
 * 支持 PDF / DOCX / XLSX / 图片 的文本提取和基础分析
 */
const path = require('path');
const fs = require('fs');

class DocumentParser {
    constructor(options = {}) {
        this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB
        this.maxTextLength = options.maxTextLength || 100000;       // 最大提取字符数
    }

    /**
     * 自动检测文件类型并解析
     * @param {string} filePath - 文件绝对路径
     * @returns {Promise<{type: string, content: string, metadata: object}>}
     */
    async parse(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const stat = fs.statSync(filePath);
        if (stat.size === 0) {
            throw new Error(`File is empty: ${filePath}`);
        }
        if (stat.size > this.maxFileSize) {
            throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max: ${this.maxFileSize / 1024 / 1024}MB`);
        }

        const ext = path.extname(filePath).toLowerCase();

        switch (ext) {
            case '.jpg':
            case '.jpeg':
            case '.png':
            case '.gif':
            case '.bmp':
            case '.webp':
            case '.tiff':
            case '.tif':
                return await this.parseImage(filePath);
            case '.pdf':
                return await this.parsePdf(filePath);
            case '.docx':
                return await this.parseDocx(filePath);
            case '.doc':
                return await this.parseDoc(filePath);
            case '.xlsx':
            case '.xls':
                return await this.parseXlsx(filePath);
            case '.csv':
                return await this.parseCsv(filePath);
            case '.txt':
            case '.md':
            case '.json':
            case '.xml':
            case '.html':
            case '.htm':
            case '.log':
            case '.yaml':
            case '.yml':
            case '.ini':
            case '.cfg':
            case '.conf':
                return await this.parseText(filePath);
            default:
                // 尝试按文本读取
                return await this.parseText(filePath);
        }
    }

    /**
     * 解析图片文件 — OCR 文字提取 + 基础信息 + base64 编码
     */
    async parseImage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.gif': 'image/gif',
            '.bmp': 'image/bmp', '.webp': 'image/webp',
            '.tiff': 'image/tiff', '.tif': 'image/tiff',
        };
        const mimeType = mimeMap[ext] || 'image/png';
        const stat = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        const fileSizeKB = (stat.size / 1024).toFixed(1);

        // 读取文件为 base64
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');

        const lines = [];
        lines.push(`[图片文件] ${fileName}`);
        lines.push(`大小: ${fileSizeKB}KB`);

        // 用 sharp 获取图片信息
        let metadata = { fileName, fileSize: stat.size, mimeType };
        try {
            const sharp = require('sharp');
            const img = sharp(buffer);
            const info = await img.metadata();
            metadata = {
                ...metadata,
                width: info.width,
                height: info.height,
                format: info.format,
                space: info.space,
                hasAlpha: info.hasAlpha,
                channels: info.channels,
                density: info.density || null,
            };
            lines.push(`尺寸: ${info.width} x ${info.height} 像素`);
            lines.push(`格式: ${info.format}`);
            lines.push(`色彩空间: ${info.space}`);
            if (info.channels) lines.push(`通道数: ${info.channels}`);
            if (info.density) lines.push(`分辨率: ${info.density} DPI`);

            // 获取主色调（取四角 + 中心像素颜色）
            try {
                const stats = await img.stats();
                const c = stats.channels;
                if (c && c.length >= 3) {
                    const avgR = Math.round(c[0].mean);
                    const avgG = Math.round(c[1].mean);
                    const avgB = Math.round(c[2].mean);
                    metadata.dominantColor = { r: avgR, g: avgG, b: avgB };
                    lines.push(`主色调: RGB(${avgR}, ${avgG}, ${avgB})`);
                    // 简单判断亮度
                    const brightness = (avgR * 299 + avgG * 587 + avgB * 114) / 1000;
                    if (brightness > 200) lines.push('亮度: 偏亮');
                    else if (brightness < 55) lines.push('亮度: 偏暗');
                    else lines.push(`亮度: 适中 (${Math.round(brightness)})`);
                }
            } catch (e) { /* stats not available */ }
        } catch (e) {
            lines.push('格式: ' + (metadata.format || mimeType));
            lines.push('(无法获取详细元数据)');
            metadata.note = 'sharp not available';
        }

        // OCR 文字提取（tesseract.js 可选）
        let ocrText = null;
        try {
            const Tesseract = require('tesseract.js');
            const ocrResult = await Tesseract.recognize(buffer, 'chi_sim+eng', {
                logger: () => {},
            });
            ocrText = ocrResult?.data?.text?.trim() || null;
            if (ocrText) {
                const wordCount = ocrText.split(/\s+/).length;
                lines.push('');
                lines.push(`[OCR 文字识别] (${wordCount} 词)`);
                lines.push(ocrText.length > 2000 ? ocrText.substring(0, 2000) + '...(截断)' : ocrText);
                metadata.ocrText = ocrText;
            } else {
                lines.push('');
                lines.push('[OCR] 未检测到文字');
            }
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' || e.message.includes('tesseract')) {
                lines.push('');
                lines.push('[OCR] 未安装 tesseract.js，跳过文字识别');
            }
            // tesseract 内部错误不阻断流程
        }

        const textContent = lines.join('\n');

        return {
            type: 'image',
            content: textContent,
            metadata: {
                ...metadata,
                _type: 'image_data',
                base64,
                mimeType,
                fileName,
                ocrText: ocrText || null,
            },
        };
    }

    /**
     * 解析 PDF 文件 — 提取文本内容
     */
    async parsePdf(filePath) {
        const fileName = path.basename(filePath);
        try {
            const pdfParse = require('pdf-parse');
            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);

            let text = data.text || '';
            if (text.length > this.maxTextLength) {
                text = text.substring(0, this.maxTextLength) + `\n\n... [文本截断，共 ${data.text.length} 字符]`;
            }

            return {
                type: 'pdf',
                content: text || '(PDF 无可提取文本，可能为扫描件)',
                metadata: {
                    fileName,
                    fileSize: buffer.length,
                    pages: data.numpages || 0,
                    pageCount: data.numpages || 0,
                    title: data.info?.Title || '',
                    author: data.info?.Author || '',
                    textLength: text.length,
                },
            };
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' || e.message.includes('pdf-parse')) {
                throw new Error('PDF parsing requires pdf-parse: run "npm install pdf-parse"');
            }
            throw new Error(`PDF parse failed: ${e.message}`);
        }
    }

    /**
     * 解析 DOCX 文件 — 提取文本内容
     */
    async parseDocx(filePath) {
        const fileName = path.basename(filePath);
        try {
            const mammoth = require('mammoth');
            const buffer = fs.readFileSync(filePath);
            const result = await mammoth.extractRawText({ buffer });

            let text = result.value || '';
            if (text.length > this.maxTextLength) {
                text = text.substring(0, this.maxTextLength) + `\n\n... [文本截断，共 ${result.value.length} 字符]`;
            }

            return {
                type: 'docx',
                content: text || '(文档为空)',
                metadata: {
                    fileName,
                    fileSize: buffer.length,
                    textLength: text.length,
                    warnings: result.messages?.filter(m => m.type === 'warning').map(m => m.message) || [],
                },
            };
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' || e.message.includes('mammoth')) {
                throw new Error('DOCX parsing requires mammoth: run "npm install mammoth"');
            }
            throw new Error(`DOCX parse failed: ${e.message}`);
        }
    }

    /**
     * 解析旧版 DOC 文件 — 尝试用 strings 命令提取文本
     */
    async parseDoc(filePath) {
        const fileName = path.basename(filePath);
        try {
            // .doc 格式较复杂，尝试用二进制中的可读字符串提取
            const buffer = fs.readFileSync(filePath);
            const text = buffer.toString('utf-8').replace(/[^\x20-\x7E一-鿿　-〿＀-￯\n\r]/g, ' ')
                .replace(/\s+/g, ' ').trim();

            const meaningful = text.length > 100 ? text : '(无法从 .doc 文件中提取有意义的文本，建议转换为 .docx 后重试)';

            return {
                type: 'doc',
                content: meaningful.substring(0, this.maxTextLength),
                metadata: {
                    fileName,
                    fileSize: buffer.length,
                    note: '.doc 格式为旧版 Word，文本提取可能不完整',
                },
            };
        } catch (e) {
            throw new Error(`DOC parse failed: ${e.message}`);
        }
    }

    /**
     * 解析 Excel 文件 — 提取表格数据为文本
     */
    async parseXlsx(filePath) {
        const fileName = path.basename(filePath);
        try {
            const XLSX = require('xlsx');
            const workbook = XLSX.readFile(filePath, { type: 'file' });

            const sheetNames = workbook.SheetNames;
            const allText = [];

            for (const sheetName of sheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

                if (jsonData.length === 0) continue;

                // 取前200行
                const displayRows = jsonData.slice(0, 200);
                const tableLines = displayRows.map((row, idx) => {
                    return `[${idx + 1}] ${row.join('\t')}`;
                });

                allText.push(`=== 工作表: ${sheetName} (${jsonData.length} 行, 显示前 ${Math.min(200, jsonData.length)} 行) ===`);
                allText.push(...tableLines);

                if (jsonData.length > 200) {
                    allText.push(`... 剩余 ${jsonData.length - 200} 行已省略`);
                }
            }

            let text = allText.join('\n');
            if (text.length > this.maxTextLength) {
                text = text.substring(0, this.maxTextLength) + `\n\n... [文本截断]`;
            }

            return {
                type: 'xlsx',
                content: text || '(表格为空)',
                metadata: {
                    fileName,
                    fileSize: fs.statSync(filePath).size,
                    sheets: sheetNames,
                    sheetCount: sheetNames.length,
                    textLength: text.length,
                },
            };
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' || e.message.includes('xlsx')) {
                throw new Error('Excel parsing requires xlsx: run "npm install xlsx"');
            }
            throw new Error(`Excel parse failed: ${e.message}`);
        }
    }

    /**
     * 解析 CSV 文件
     */
    async parseCsv(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        const maxLines = 500;

        const header = lines[0] || '(空)';
        const dataLines = lines.slice(1, maxLines).map((line, i) => `[${i + 1}] ${line}`);

        let text = `[CSV 文件] ${lines.length} 行\n表头: ${header}\n${dataLines.join('\n')}`;
        if (lines.length > maxLines) {
            text += `\n...剩余 ${lines.length - maxLines} 行已省略`;
        }

        return {
            type: 'csv',
            content: text,
            metadata: { fileName: path.basename(filePath), rowCount: lines.length - 1 },
        };
    }

    /**
     * 解析纯文本文件
     */
    async parseText(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileName = path.basename(filePath);
        return {
            type: 'text',
            content: content.length > this.maxTextLength
                ? content.substring(0, this.maxTextLength) + `\n\n... [文本截断，共 ${content.length} 字符]`
                : content,
            metadata: { fileName, fileSize: Buffer.byteLength(content, 'utf-8'), textLength: content.length },
        };
    }
}

module.exports = DocumentParser;
