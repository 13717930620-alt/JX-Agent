/**
 * BrowserManager — persistent browser lifecycle manager using Puppeteer.
 * Puppeteer is optional; missing gracefully degrades instead of crashing.
 */
let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = null;
}
const path = require('path');
const fs = require('fs');

class BrowserManager {
    constructor() {
        this.browser = null;
        this.pages = new Map(); // 存储页面实例 { pageId: page }
        this.config = {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
            defaultViewport: { width: 1920, height: 1080 }
        };
    }

    /**
     * 获取或启动浏览器实例
     */
    async getBrowser() {
        if (this.browser) return this.browser;

        try {
            this.browser = await puppeteer.launch({
                headless: this.config.headless,
                args: this.config.args,
                defaultViewport: this.config.defaultViewport
            });
            console.log('[BrowserManager] Browser started successfully ✅');
            return this.browser;
        } catch (e) {
            console.error('[BrowserManager] Failed to launch browser:', e);
            throw e;
        }
    }

    /**
     * 创建或获取页面
     * @param {string} pageId 页面唯一标识，不提供则创建新页
     */
    async getPage(pageId = null) {
        const browser = await this.getBrowser();
        
        if (pageId && this.pages.has(pageId)) {
            return this.pages.get(pageId);
        }

        const page = await browser.newPage();
        const id = pageId || `page_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        this.pages.set(id, page);
        return page;
    }

    /**
     * 关闭指定页面
     */
    async closePage(pageId) {
        if (this.pages.has(pageId)) {
            const page = this.pages.get(pageId);
            await page.close();
            this.pages.delete(pageId);
            return { closed: true, pageId };
        }
        return { closed: false, error: 'Page not found' };
    }

    /**
     * 强制重启浏览器
     */
    async restart() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.pages.clear();
        }
        return await this.getBrowser();
    }

    /**
     * 切换有头/无头模式 (需要重启)
     */
    async setHeadless(value) {
        this.config.headless = value;
        await this.restart();
    }
}

// 导出单例
module.exports = new BrowserManager();
