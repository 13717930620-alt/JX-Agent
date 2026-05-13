/**
 * TunnelService — exposes a local web service to the public internet via localtunnel.
 */
class TunnelService {
    constructor() {
        this._tunnel = null;
        this._url = null;
    }

    get url() { return this._url; }
    get isActive() { return !!this._tunnel; }

    /**
     * 启动隧道
     * @param {number} port 本地端口（默认 3000）
     * @returns {{ url: string }}
     */
    async start(port = 3000) {
        if (this._tunnel) {
            return { url: this._url };
        }
        const localtunnel = require('localtunnel');
        this._tunnel = await localtunnel({ port });
        this._url = this._tunnel.url;

        this._tunnel.on('close', () => {
            this._tunnel = null;
            this._url = null;
        });

        console.log(`[TunnelService] Remote access enabled: ${this._url}`);
        return { url: this._url };
    }

    /**
     * 关闭隧道
     */
    stop() {
        if (this._tunnel) {
            this._tunnel.close();
            this._tunnel = null;
            this._url = null;
            console.log('[TunnelService] Remote access disabled');
        }
    }
}

module.exports = TunnelService;
