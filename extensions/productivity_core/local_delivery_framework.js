/**
 * local_delivery_framework.js
 * 功能：通用的本地文件生成与分发系统，样式由 USER.md 动态决定
 */
const fs = require('fs');
const path = require('path');

class LocalDeliveryFramework {
    constructor(agent) {
        this.agent = agent;
        this.userPrefs = {};
    }

    async refreshPreferences() {
        // 从 USER.md 中动态读取偏好
        const userFile = path.join(process.cwd(), 'USER.md');
        if (fs.existsSync(userFile)) {
            const content = fs.readFileSync(userFile, 'utf8');
            this.userPrefs = this._parsePrefs(content);
        } else {
            this.userPrefs = {
                outputDir: './outputs',
                stylePreset: 'default'
            };
        }
    }

    _parsePrefs(content) {
        const prefs = {};
        const pathMatch = content.match(/Preferred Output Path:\s*(.*)/);
        const styleMatch = content.match(/Document Style:\s*(.*)/);
        if (pathMatch) prefs.outputDir = pathMatch[1].trim();
        if (styleMatch) prefs.stylePreset = styleMatch[1].trim();
        return prefs;
    }

    async saveFile(fileName, content, type = 'text') {
        await this.refreshPreferences();
        const dir = this.userPrefs.outputDir || './outputs';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const fullPath = path.join(dir, fileName);
        
        if (type === 'text') {
            fs.writeFileSync(fullPath, content, 'utf8');
        } else {
            // 这里集成 docx/pptxgenjs 的通用工厂
            // 为了保持通用性，这里仅提供框架，具体样式由 StyleLibrary 决定
            console.log(`[LocalDelivery] 正在使用样式 ${this.userPrefs.stylePreset} 生成 ${type} 文件...`);
            // ... 具体的 docx/pptx 构建逻辑 (根据 stylePreset 切换) ...
            fs.writeFileSync(fullPath, `[Styled ${type} Content]\n${content}`, 'utf8'); 
        }
        return fullPath;
    }
}

module.exports = LocalDeliveryFramework;
