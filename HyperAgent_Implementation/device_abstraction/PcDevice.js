// PcDevice - Windows PC device implementation

const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const DeviceAbstraction = require('./DeviceAbstraction');

class PcDevice extends DeviceAbstraction {
    constructor() {
        super('pc', 'Windows PC');
        this._setDefaultSafetyLimits();
    }

    _setDefaultSafetyLimits() {
        this.setSafetyLimits({
            exec_cmd: {
                cmd: {
                    denyValues: [
                        'shutdown', 'shutdown /s', 'shutdown /r', 'shutdown /p',
                        'format', 'format c:', 'diskpart', 'del /f /s',
                        'rd /s /q', 'rmdir /s /q', 'reg delete',
                        'net user', 'net localgroup',
                    ]
                }
            }
        });
    }

    getDeviceInfo() {
        return {
            type: 'pc',
            name: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            version: os.release(),
            user: os.userInfo().username,
            uptime: os.uptime(),
            cpuCount: os.cpus().length,
            totalMem: os.totalmem(),
            hostname: os.hostname(),
            osDesc: `${os.platform()} ${os.release()} (${os.arch()})`
        };
    }

    getSensors() {
        let diskInfo = [];
        try {
            const df = execSync('wmic logicaldisk get caption,size,freespace /format:csv', { encoding: 'utf8', timeout: 5000 });
            const lines = df.trim().split('\n').slice(1);
            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 3 && parts[1]) {
                    diskInfo.push({
                        drive: parts[1],
                        freeBytes: parseInt(parts[2]) || 0,
                        totalBytes: parseInt(parts[3]) || 0
                    });
                }
            }
        } catch (e) { diskInfo = [{ error: e.message }]; }

        let networkInfo = [];
        try {
            const nets = os.networkInterfaces();
            for (const [name, addrs] of Object.entries(nets)) {
                for (const addr of addrs || []) {
                    if (!addr.internal) {
                        networkInfo.push({ name, address: addr.address, family: addr.family });
                    }
                }
            }
        } catch (e) { networkInfo = []; }

        return {
            cpu: {
                count: os.cpus().length,
                model: os.cpus()[0]?.model || 'unknown',
                load: os.loadavg(),
                usagePercent: os.loadavg()[0] / os.cpus().length
            },
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem(),
                usagePercent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)
            },
            disk: diskInfo,
            network: networkInfo,
            time: {
                system: new Date().toISOString(),
                uptime: os.uptime()
            },
            processes: this._getProcessCount()
        };
    }

    _getProcessCount() {
        try {
            const output = execSync('tasklist /NH /FO CSV', { encoding: 'utf8', timeout: 3000 });
            return { count: output.trim().split('\n').filter(l => l).length };
        } catch (e) { return { count: 0 }; }
    }

    /**
     * PC device tool definitions
     */
    getToolDefinitions() {
        return [
            // 系统信息
            {
                name: 'sys_info',
                description: '获取 Windows PC 系统信息（主机名/CPU/内存/磁盘/网络/操作系统）',
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'sys_sensors',
                description: '获取 PC 实时传感器数据（CPU负载/内存使用率/磁盘空间/网络状态/进程数）',
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'sys_time',
                description: '获取当前系统时间和时区',
                parameters: { type: 'object', properties: {} }
            },

            // 文件操作
            {
                name: 'file_read',
                description: '读取本地文件内容（文本格式）',
                parameters: { type: 'object', properties: { path: { type: 'string', description: '文件完整路径' } }, required: ['path'] }
            },
            {
                name: 'file_write',
                description: '写入内容到本地文件（自动创建父目录）',
                parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
            },
            {
                name: 'file_delete',
                description: '删除本地文件',
                parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
            },
            {
                name: 'dir_list',
                description: '列出目录内容',
                parameters: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean', description: '是否递归列出子目录' } }, required: ['path'] }
            },
            {
                name: 'dir_create',
                description: '创建目录（自动创建父目录）',
                parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
            },

            // 命令执行
            {
                name: 'exec_cmd',
                description: '执行 cmd 命令并获取输出',
                parameters: { type: 'object', properties: { cmd: { type: 'string' }, cwd: { type: 'string', description: '工作目录（可选）' }, timeout: { type: 'number' } }, required: ['cmd'] }
            },
            {
                name: 'exec_powershell',
                description: '执行 PowerShell 脚本并获取输出',
                parameters: { type: 'object', properties: { script: { type: 'string' }, timeout: { type: 'number' } }, required: ['script'] }
            },

            // 进程管理
            {
                name: 'process_list',
                description: '查看运行中的进程列表',
                parameters: { type: 'object', properties: { filter: { type: 'string', description: '按进程名过滤（可选）' } } }
            },
            {
                name: 'process_kill',
                description: '终止指定进程',
                parameters: { type: 'object', properties: { pid: { type: 'string', description: '进程 PID' } }, required: ['pid'] }
            },

            // 网络
            {
                name: 'network_info',
                description: '获取网络配置信息（IP地址/接口/DNS）',
                parameters: { type: 'object', properties: {} }
            },

            // 系统控制
            {
                name: 'system_open_url',
                description: '用默认浏览器打开 URL',
                parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
            },
            {
                name: 'system_open_file',
                description: '用默认程序打开文件',
                parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
            },
            {
                name: 'system_notification',
                description: '发送 Windows 桌面通知',
                parameters: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' } }, required: ['title', 'message'] }
            },
            {
                name: 'system_clipboard_set',
                description: '设置剪贴板文本',
                parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
            },
            {
                name: 'system_clipboard_get',
                description: '获取剪贴板文本内容',
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'desktop_screenshot',
                description: '截取桌面屏幕截图',
                parameters: { type: 'object', properties: { path: { type: 'string', description: '图片保存路径（可选）' } } }
            },
        ];
    }

    /**
     * PC tool execution logic
     */
    async executeTool(toolName, params) {
        switch (toolName) {
            // 系统信息
            case 'sys_info':
                return { verified: true, data: this.getDeviceInfo() };

            case 'sys_sensors':
                return { verified: true, data: this.getSensors() };

            case 'sys_time':
                return { verified: true, data: { iso: new Date().toISOString(), local: new Date().toLocaleString(), unix: Date.now() } };

            // 文件操作
            case 'file_read':
                if (!fs.existsSync(params.path)) throw new Error(`File not found: ${params.path}`);
                return { verified: true, data: { content: fs.readFileSync(params.path, 'utf8'), path: params.path } };

            case 'file_write': {
                const dir = path.dirname(params.path);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(params.path, params.content, 'utf8');
                return { verified: true, data: { path: params.path, bytes: params.content.length } };
            }

            case 'file_delete': {
                if (!fs.existsSync(params.path)) throw new Error(`File not found: ${params.path}`);
                fs.unlinkSync(params.path);
                return { verified: true, data: { deleted: true, path: params.path } };
            }

            case 'dir_list': {
                if (!fs.existsSync(params.path)) throw new Error(`Directory not found: ${params.path}`);
                const entries = fs.readdirSync(params.path, { withFileTypes: true });
                const items = entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), size: e.isFile() ? fs.statSync(path.join(params.path, e.name)).size : 0 }));
                return { verified: true, data: { path: params.path, items } };
            }

            case 'dir_create': {
                if (!fs.existsSync(params.path)) fs.mkdirSync(params.path, { recursive: true });
                return { verified: true, data: { path: params.path, created: true } };
            }

            // 命令执行
            case 'exec_cmd':
                return new Promise((resolve) => {
                    const { exec } = require('child_process');
                    exec(params.cmd, { cwd: params.cwd, encoding: 'utf8', timeout: params.timeout || 30000, maxBuffer: 10 * 1024 * 1024 },
                        (error, stdout, stderr) => {
                            if (error) resolve({ verified: false, error: error.message, data: { stderr: stderr?.trim() } });
                            else resolve({ verified: true, data: { stdout: stdout.trim(), stderr: stderr?.trim() } });
                        });
                });

            case 'exec_powershell':
                return new Promise((resolve) => {
                    const { exec } = require('child_process');
                    exec(`powershell -NoProfile -Command "${params.script.replace(/"/g, '\\"')}"`,
                        { encoding: 'utf8', timeout: params.timeout || 30000 },
                        (error, stdout) => {
                            if (error) resolve({ verified: false, error: error.message });
                            else resolve({ verified: true, data: { output: stdout.trim() } });
                        });
                });

            // 进程操作
            case 'process_list': {
                const filter = params.filter || '*';
                let output;
                try {
                    output = execSync(`tasklist /FI "IMAGENAME eq ${filter}" /FO CSV /NH`, { encoding: 'utf8', timeout: 5000 });
                } catch (e) { output = ''; }
                const procs = output.trim().split('\n').filter(l => l).map(l => {
                    const parts = l.replace(/"/g, '').split(',');
                    return { name: parts[0], pid: parts[1], mem: parts[4] };
                });
                return { verified: true, data: { processes: procs, count: procs.length } };
            }

            case 'process_kill': {
                execSync(`taskkill /F /PID ${params.pid}`, { encoding: 'utf8', timeout: 5000 });
                return { verified: true, data: { killed: true, pid: params.pid } };
            }

            // 网络
            case 'network_info': {
                const interfaces = os.networkInterfaces();
                const result = [];
                for (const [name, addrs] of Object.entries(interfaces)) {
                    for (const addr of addrs || []) {
                        if (!addr.internal) result.push({ name, address: addr.address, family: addr.family, mac: addr.mac });
                    }
                }
                return { verified: true, data: { interfaces: result } };
            }

            // 系统控制
            case 'system_open_url': {
                const { exec } = require('child_process');
                exec(`start "" "${params.url}"`);
                return { verified: true, data: { opened: params.url } };
            }

            case 'system_open_file': {
                const { exec } = require('child_process');
                exec(`start "" "${params.path}"`);
                return { verified: true, data: { opened: params.path } };
            }

            case 'system_notification': {
                const { exec } = require('child_process');
                const escaped = params.message.replace(/"/g, '\\"');
                exec(`powershell -Command "& {[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $notify = New-Object System.Windows.Forms.NotifyIcon; $notify.Icon = [System.Drawing.SystemIcons]::Information; $notify.BalloonTipTitle = '${params.title}'; $notify.BalloonTipText = '${escaped}'; $notify.Visible = $true; $notify.ShowBalloonTip(3000)}"`);
                return { verified: true, data: { notified: true } };
            }

            case 'system_clipboard_set': {
                const { exec } = require('child_process');
                const encoded = Buffer.from(params.text).toString('base64');
                exec(`powershell -Command "& {[System.Windows.Forms.Clipboard]::SetText([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')))}"`);
                return { verified: true, data: { set: true } };
            }

            case 'system_clipboard_get':
                return { verified: true, data: { text: 'Clipboard read requires PowerShell', note: 'use exec_powershell with Get-Clipboard' } };

            case 'desktop_screenshot': {
                const screenshotPath = params.path || path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);
                const { exec } = require('child_process');
                const psScript = `Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $img = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); $g = [System.Drawing.Graphics]::FromImage($img); $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); $img.Save('${screenshotPath.replace(/\\/g, '\\\\')}'); $g.Dispose(); $img.Dispose()`;
                return new Promise((resolve) => {
                    exec(`powershell -NoProfile -Command "${psScript}"`, { timeout: 15000 }, (error) => {
                        if (error) resolve({ verified: false, error: error.message });
                        else resolve({ verified: true, data: { path: screenshotPath, note: 'Screenshot saved' } });
                    });
                });
            }

            default:
                return { verified: false, error: `PC device does not support tool: ${toolName}` };
        }
    }
}

module.exports = PcDevice;
