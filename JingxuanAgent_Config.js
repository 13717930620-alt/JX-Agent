// JingxuanAgent_Config — 根目录配置文件
// 重新导出 JingxuanAgent_Core/infra 中的配置

const path = require('path');

let config = {};
try {
    config = require('./JingxuanAgent_Core/infra/JingxuanAgent_Config.js');
} catch (e) {
    // 回退: 从 .env 读取
    try { require('dotenv').config(); } catch (e2) {}
}

module.exports = config;
