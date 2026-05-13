/**
 * build.js — 源代码混淆构建脚本
 * 混淆后端 .js 文件，保留前端 (.html/.css) 和 node_modules
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SOURCE_DIR = path.resolve(__dirname, '..', 'hyperagent安装和使用说明', 'source');
const EXCLUDE_DIRS = ['node_modules', '.git'];
const TARGET_EXT = '.js';

let totalFiles = 0;
let totalObfuscated = 0;
let skippedFiles = [];

function shouldProcess(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== TARGET_EXT) return false;
    const relPath = path.relative(SOURCE_DIR, filePath).replace(/\\/g, '/');
    if (relPath.startsWith('web/') && !relPath.startsWith('web/server')) return false;
    if (relPath.startsWith('tests/')) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('Obfuscator:true')) return false;
    return true;
}

function obfuscateFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    try {
        const obfuscated = JavaScriptObfuscator.obfuscate(content, {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: false,    // 不阻止调试（避免影响正常运行）
            disableConsoleOutput: false, // 保留 console 输出
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: false,
            rotateStringArray: true,
            selfDefending: false,
            shuffleStringArray: true,
            splitStrings: true,
            splitStringsChunkLength: 10,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.75,
            transformObjectKeys: true,
            unicodeEscapeSequence: false
        }).getObfuscatedCode();

        fs.writeFileSync(filePath, obfuscated, 'utf8');
        return true;
    } catch (e) {
        console.error(`  [FAIL] 混淆失败: ${path.relative(SOURCE_DIR, filePath)} — ${e.message}`);
        skippedFiles.push(path.relative(SOURCE_DIR, filePath));
        return false;
    }
}

function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.includes(entry.name)) continue;
            walkDir(fullPath);
        } else if (entry.isFile()) {
            totalFiles++;
            if (shouldProcess(fullPath)) {
                process.stdout.write(`  [PROCESS] ${path.relative(SOURCE_DIR, fullPath)}... `);
                if (obfuscateFile(fullPath)) {
                    console.log('[OK]');
                    totalObfuscated++;
                }
            }
        }
    }
}

// Main

console.log('');
console.log('[JingxuanAgent Build] 源码混淆构建工具');
console.log('');

if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`[ERROR] 目标目录不存在: ${SOURCE_DIR}`);
    process.exit(1);
}

console.log(`[DIR] 目标: ${SOURCE_DIR}`);
console.log('');

walkDir(SOURCE_DIR);

console.log('');
console.log('---');
console.log(`[SUMMARY] 总计: ${totalFiles} 文件，混淆 ${totalObfuscated} 文件`);
if (skippedFiles.length > 0) {
    console.log(`[WARN] 跳过失败: ${skippedFiles.length} 文件`);
    skippedFiles.forEach(f => console.log(`   - ${f}`));
}
console.log('[DONE] 构建完成');
console.log('');
