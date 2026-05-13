/**
 * ExtendedTools — device control extensions: browser, system, service, network, power, registry.
 */

const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const browserManager = require('./BrowserManager');

// Browser automation (Puppeteer)
const BrowserTools = {
    browser_open: async (params) => {
        const { url: targetUrl, pageId = null, headless = true } = params;
        try {
            if (headless !== undefined) await browserManager.setHeadless(headless);
            const page = await browserManager.getPage(pageId);
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            return { verified: true, data: { message: 'Page opened', url: targetUrl, pageId: pageId || 'default' } };
        } catch (e) {
            return { verified: false, error: `browser_open failed: ${e.message}` };
        }
    },

    browser_click: async (params) => {
        const { selector, pageId, timeout = 5000 } = params;
        try {
            const page = await browserManager.getPage(pageId);
            await page.waitForSelector(selector, { timeout });
            await page.click(selector);
            return { verified: true, data: { message: `Clicked ${selector}` } };
        } catch (e) {
            return { verified: false, error: `browser_click failed: ${e.message}` };
        }
    },

    browser_type: async (params) => {
        const { selector, text, pageId, timeout = 5000 } = params;
        try {
            const page = await browserManager.getPage(pageId);
            await page.waitForSelector(selector, { timeout });
            await page.type(selector, text);
            return { verified: true, data: { message: `Typed into ${selector}` } };
        } catch (e) {
            return { verified: false, error: `browser_type failed: ${e.message}` };
        }
    },

    browser_screenshot: async (params) => {
        const { path: savePath, pageId, fullPage = false } = params;
        try {
            const page = await browserManager.getPage(pageId);
            await page.screenshot({ path: savePath, fullPage });
            return { verified: true, data: { path: savePath, saved: true } };
        } catch (e) {
            return { verified: false, error: `browser_screenshot failed: ${e.message}` };
        }
    },

    browser_get_html: async (params) => {
        const { pageId } = params;
        try {
            const page = await browserManager.getPage(pageId);
            const content = await page.content();
            return { verified: true, data: { content: content.substring(0, 50000) } };
        } catch (e) {
            return { verified: false, error: `browser_get_html failed: ${e.message}` };
        }
    },

    browser_close: async (params) => {
        const { pageId } = params;
        try {
            await browserManager.closePage(pageId);
            return { verified: true, data: { closed: true } };
        } catch (e) {
            return { verified: false, error: `browser_close failed: ${e.message}` };
        }
    }
};

// System tools (Windows desktop)
const SystemTools = {
    system_clipboard_get: async () => {
        return new Promise((resolve) => {
            const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()`;
            exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, (error, stdout) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { content: stdout.trim() } });
            });
        });
    },

    system_clipboard_set: async (params) => {
        const { text } = params;
        return new Promise((resolve) => {
            const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText("${text.replace(/"/g, '\\"')}")`;
            exec(`powershell -NoProfile -Command "${ps}"`, (error) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { message: 'Clipboard set' } });
            });
        });
    },

    system_notification: async (params) => {
        const { title, message } = params;
        return new Promise((resolve) => {
            const ps = `
$title = "${title}"
$msg = "${message}"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > \$null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName("text")
$textNodes.Item(0).AppendChild($template.CreateTextNode($title)) > \$null
$textNodes.Item(1).AppendChild($template.CreateTextNode($msg)) > \$null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("JingxuanAgent").Show($toast)
`;
            exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\$/g, '`$')}"`, (error) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { sent: true } });
            });
        });
    },

    system_open_file: async (params) => {
        const { path: filePath } = params;
        return new Promise((resolve) => {
            exec(`powershell -NoProfile -Command "Start-Process '${filePath.replace(/'/g, "''")}'"`, (error) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { opened: filePath } });
            });
        });
    },

    system_open_url: async (params) => {
        const { url: targetUrl } = params;
        return new Promise((resolve) => {
            exec(`powershell -NoProfile -Command "Start-Process '${targetUrl.replace(/'/g, "''")}'"`, (error) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { opened: targetUrl } });
            });
        });
    }
};

// Service control (Windows)
const ServiceTools = {
    service_list: async (params) => {
        const { filter = '' } = params;
        return new Promise((resolve) => {
            exec(`sc query ${filter ? `"${filter}"` : ''}`, { encoding: 'utf8', timeout: 10000 }, (error, stdout) => {
                if (error) resolve({ verified: false, error: error.message });
                else {
                    const services = [];
                    const lines = stdout.split('\n');
                    let current = {};
                    for (const line of lines) {
                        if (line.includes('SERVICE_NAME:')) current.name = line.split(':')[1]?.trim();
                        if (line.includes('DISPLAY_NAME:')) current.displayName = line.split(':')[1]?.trim();
                        if (line.includes('STATE')) {
                            const stateMatch = line.match(/:\s*(\d+)\s+(\S+)/);
                            if (stateMatch) current.state = stateMatch[2];
                        }
                        if (line.trim() === '' && current.name) {
                            services.push(current);
                            current = {};
                        }
                    }
                    resolve({ verified: true, data: { services, count: services.length } });
                }
            });
        });
    },

    service_control: async (params) => {
        const { name, action } = params;
        if (!['start', 'stop', 'restart', 'pause', 'continue'].includes(action)) {
            return { verified: false, error: `不支持的操作: ${action}。支持: start/stop/restart/pause/continue` };
        }
        return new Promise((resolve) => {
            exec(`sc ${action} "${name}"`, { encoding: 'utf8', timeout: 15000 }, (error, stdout) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { service: name, action, result: stdout.trim() } });
            });
        });
    }
};

// Network tools
const NetworkTools = {
    network_info: async () => {
        return new Promise((resolve) => {
            exec('ipconfig /all', { encoding: 'utf8', timeout: 10000 }, (error, stdout) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { output: stdout.substring(0, 10000) } });
            });
        });
    }
};

// Power management
const PowerTools = {
    system_power: async (params) => {
        const { action } = params;
        const validActions = ['shutdown', 'restart', 'sleep', 'hibernate', 'lock', 'logout'];
        if (!validActions.includes(action)) {
            return { verified: false, error: `不支持: ${action}` };
        }
        const commands = {
            shutdown: 'shutdown /s /t 10 /c "JingxuanAgent 触发的关机"',
            restart: 'shutdown /r /t 10 /c "JingxuanAgent 触发的重启"',
            sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
            lock: 'rundll32.exe user32.dll,LockWorkStation',
            logout: 'shutdown /l'
        };
        return new Promise((resolve) => {
            exec(commands[action], (error) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { action, initiated: true } });
            });
        });
    }
};

// Desktop screenshot
const DesktopTools = {
    desktop_screenshot: async (params) => {
        const { path: savePath } = params;
        const outputPath = savePath || path.join(require('os').tmpdir(), `screenshot_${Date.now()}.png`);
        return new Promise((resolve) => {
            const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$image = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($image)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$image.Save('${outputPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$image.Dispose()
`;
            exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, (error) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { path: outputPath } });
            });
        });
    }
};

// Registry tools (high risk)
const RegistryTools = {
    registry_read: async (params) => {
        const { path: regPath } = params;
        return new Promise((resolve) => {
            exec(`reg query "${regPath}"`, { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { output: stdout.trim() } });
            });
        });
    },

    registry_write: async (params) => {
        const { path: regPath, name, value, type = 'REG_SZ' } = params;
        return new Promise((resolve) => {
            exec(`reg add "${regPath}" /v "${name}" /t ${type} /d "${value}" /f`, { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
                if (error) resolve({ verified: false, error: error.message });
                else resolve({ verified: true, data: { result: stdout.trim() } });
            });
        });
    }
};

// Exports: merge all extension tools
module.exports = {
    ...BrowserTools,
    ...SystemTools,
    ...ServiceTools,
    ...NetworkTools,
    ...PowerTools,
    ...DesktopTools,
    ...RegistryTools
};
