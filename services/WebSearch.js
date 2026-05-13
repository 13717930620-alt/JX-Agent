/**
 * WebSearch — 网络搜索服务
 *
 * 搜索方式（按优先级）:
 *   1. TAVILY_API_KEY → Tavily Search API (推荐)
 *   2. SERPAPI_KEY    → SerpAPI (Google 搜索)
 *   3. 无 API Key     → Bing 网页抓取 (内置, 无需 Key)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const GOOGLE_CX = process.env.GOOGLE_CX || '';

/**
 * 执行网络搜索
 * @param {string} query 搜索关键词
 * @param {number} topK 返回结果数 (默认5)
 * @returns {Promise<string>} 格式化的搜索结果文本
 */
async function search(query, topK = 5) {
    if (TAVILY_API_KEY) return searchTavily(query, topK);
    if (SERPAPI_KEY) return searchSerpapi(query, topK);
    if (GOOGLE_API_KEY && GOOGLE_CX) return searchGoogle(query, topK);
    return searchBing(query, topK);
}

/**
 * Tavily Search API
 */
async function searchTavily(query, topK) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            api_key: TAVILY_API_KEY,
            query,
            max_results: topK,
            search_depth: 'basic',
        });
        const req = https.request({
            hostname: 'api.tavily.com',
            path: '/search',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
            },
            timeout: 15000,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.results && json.results.length > 0) {
                        const lines = json.results.map((r, i) =>
                            `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.content || r.snippet || ''}`
                        );
                        resolve(lines.join('\n\n'));
                    } else {
                        resolve('未找到相关结果。');
                    }
                } catch (e) {
                    reject(new Error(`Tavily 解析失败: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Tavily 请求超时')); });
        req.write(body);
        req.end();
    });
}

/**
 * SerpAPI (Google)
 */
async function searchSerpapi(query, topK) {
    return new Promise((resolve, reject) => {
        const url = `/search?q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=${topK}`;
        https.get({
            hostname: 'serpapi.com',
            path: url,
            timeout: 15000,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const results = json.organic_results || [];
                    if (results.length > 0) {
                        const lines = results.slice(0, topK).map((r, i) =>
                            `[${i + 1}] ${r.title}\n    URL: ${r.link}\n    ${r.snippet || ''}`
                        );
                        resolve(lines.join('\n\n'));
                    } else {
                        resolve('未找到相关结果。');
                    }
                } catch (e) {
                    reject(new Error(`SerpAPI 解析失败: ${data.substring(0, 200)}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Google Custom Search API
 */
async function searchGoogle(query, topK) {
    return new Promise((resolve, reject) => {
        const url = `/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=${Math.min(topK, 10)}`;
        https.get({
            hostname: 'www.googleapis.com',
            path: url,
            timeout: 15000,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const items = json.items || [];
                    if (items.length > 0) {
                        const lines = items.slice(0, topK).map((r, i) =>
                            `[${i + 1}] ${r.title}\n    URL: ${r.link}\n    ${r.snippet || ''}`
                        );
                        resolve(lines.join('\n\n'));
                    } else {
                        resolve('未找到相关结果。');
                    }
                } catch (e) {
                    reject(new Error(`Google API 解析失败: ${data.substring(0, 200)}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Bing 网页抓取 (内置, 无需 API Key)
 * 自动处理地区重定向 (www.bing.com → cn.bing.com 等)
 */
async function searchBing(query, topK) {
    return bingFetch('www.bing.com', `/search?q=${encodeURIComponent(query)}&count=${topK}`, query, topK, 0);
}

/**
 * Bing 递归抓取，支持重定向跟随
 */
function bingFetch(hostname, path, query, topK, redirectCount) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 3) {
            resolve(`[WebSearch] Bing 搜索 "${query}" 重定向次数过多。`);
            return;
        }
        const req = https.get({
            hostname,
            path,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            timeout: 15000,
        }, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const location = res.headers.location;
                let redirectHost = hostname;
                let redirectPath = location;
                if (location.startsWith('http')) {
                    const url = new URL(location);
                    redirectHost = url.hostname;
                    redirectPath = url.pathname + url.search;
                }
                res.resume();
                resolve(bingFetch(redirectHost, redirectPath, query, topK, redirectCount + 1));
                return;
            }

            let html = '';
            res.on('data', c => html += c);
            res.on('end', () => {
                try {
                    const results = parseBingHtml(html, topK);
                    if (results.length > 0) {
                        resolve(results.join('\n\n'));
                    } else {
                        resolve(`[WebSearch] Bing 搜索 "${query}" 未找到结果。`);
                    }
                } catch (e) {
                    resolve(`[WebSearch] Bing 搜索结果解析异常。`);
                }
            });
        });
        req.on('error', (e) => {
            resolve(`[WebSearch] Bing 搜索失败: ${e.message}。请设置 TAVILY_API_KEY 环境变量使用 Tavily API 以获得更稳定的搜索服务。`);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(`[WebSearch] Bing 搜索超时。请设置 TAVILY_API_KEY 环境变量使用 Tavily API 以获得更稳定的搜索服务。`);
        });
    });
}

/**
 * 从 Bing HTML 中解析搜索结果
 */
function parseBingHtml(html, topK) {
    const results = [];
    // Bing 搜索结果在 <li class="b_algo"> 中
    const algoRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = algoRegex.exec(html)) !== null && results.length < topK) {
        const item = match[1];
        const titleMatch = item.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/i);
        const snippetMatch = item.match(/<p[^>]*>(.*?)<\/p>/i) || item.match(/<div[^>]*class="b_caption"[^>]*>[\s\S]*?<p[^>]*>(.*?)<\/p>/i);

        if (titleMatch) {
            const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
            const url = titleMatch[1];
            const snippet = snippetMatch
                ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim()
                : '';
            if (title && url) {
                results.push(`[${results.length + 1}] ${title}\n    URL: ${url}\n    ${snippet}`);
            }
        }
    }
    return results;
}

module.exports = { search };
