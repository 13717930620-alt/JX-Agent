#!/usr/bin/env node
/**
 * mcp_server_shell.js - Shell 命令 MCP 服务器
 */
const { exec } = require('child_process');

const allowedPrefixes = [
  process.env.USERPROFILE || 'C:\\Users\\13717',
  'C:\\Users\\13717\\Desktop',
  process.env.TEMP || 'C:\\Windows\\Temp',
];

const blockedCommands = [
  /^shutdown/i, /^reboot/i, /^halt/i, /^poweroff/i,
  /^format/i, /^del \/f/i, /^rd \/s/i, /^rmdir \/s/i,
  /^reg delete/i, /^diskpart/i,
];

let requestId = 0;

function isPathAllowed(cwd) {
  if (!cwd) return true;
  return allowedPrefixes.some(p => cwd.startsWith(p));
}

function isCommandAllowed(cmd) {
  return !blockedCommands.some(pattern => pattern.test(cmd.trim()));
}

function sendMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function handleRequest(req) {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      sendMessage({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'hyperagent-shell', version: '1.0.0' }
        }
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      sendMessage({
        jsonrpc: '2.0', id,
        result: {
          tools: [
            {
              name: 'exec',
              description: '执行 shell 命令（cmd.exe）。返回 stdout/stderr 和退出码。',
              inputSchema: {
                type: 'object',
                properties: {
                  command: {
                    type: 'string',
                    description: '要执行的命令'
                  },
                  cwd: {
                    type: 'string',
                    description: '工作目录（可选，默认用户目录）'
                  },
                  timeout: {
                    type: 'number',
                    description: '超时时间（毫秒，默认 30000）'
                  }
                },
                required: ['command']
              }
            },
            {
              name: 'read_output',
              description: '获取命令执行的全部输出',
              inputSchema: {
                type: 'object',
                properties: {
                  pid: { type: 'number', description: '进程 PID' }
                },
                required: ['pid']
              }
            },
            {
              name: 'system_info',
              description: '获取系统基本信息（OS、CPU、内存、磁盘）',
              inputSchema: {
                type: 'object',
                properties: {}
              }
            }
          ]
        }
      });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;

      if (name === 'exec') {
        if (!args.command) {
          sendMessage({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing required parameter: command' } });
          return;
        }
        if (!isCommandAllowed(args.command)) {
          sendMessage({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Command blocked for security reasons' } });
          return;
        }

        const cwd = args.cwd || process.env.USERPROFILE;
        if (!isPathAllowed(cwd)) {
          sendMessage({ jsonrpc: '2.0', id, error: { code: -32000, message: `Working directory not allowed: ${cwd}` } });
          return;
        }

        const timeout = args.timeout || 30000;

        exec(args.command, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          sendMessage({
            jsonrpc: '2.0', id,
            result: {
              content: [
                { type: 'text', text: stdout || '' },
                ...(stderr ? [{ type: 'text', text: `STDERR:\n${stderr}` }] : []),
                ...(error ? [{ type: 'text', text: `\nExit code: ${error.code || -1}${error.signal ? ` (signal: ${error.signal})` : ''}` }] : [{ type: 'text', text: '\nExit code: 0' }])
              ]
            }
          });
        });
      } else if (name === 'system_info') {
        const os = require('os');
        const info = {
          platform: os.platform(),
          hostname: os.hostname(),
          cpus: os.cpus().length,
          arch: os.arch(),
          totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
          freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
          uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
          userInfo: os.userInfo().username,
        };
        sendMessage({
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(info, null, 2) }]
          }
        });
      } else {
        sendMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${name}` } });
      }
      break;
    }

    default:
      if (id) {
        sendMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
}

let buffer = '';
process.stdin.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleRequest(JSON.parse(line));
    } catch (e) {
      // 忽略解析错误
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
