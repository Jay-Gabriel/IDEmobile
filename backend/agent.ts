import { Socket } from 'socket.io';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

const WORKSPACE_DIR = path.resolve(__dirname, 'workspace');

// ─── Shell helper ───────────────────────────────────────────────────────────
function runShell(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
      let out = '';
      if (stdout) out += stdout;
      if (stderr) out += `\n[stderr]\n${stderr}`;
      if (error && !out) out += `\n[error]\n${error.message}`;
      resolve(out.trim() || '(no output)');
    });
  });
}

// ─── Path safety ────────────────────────────────────────────────────────────
function safePath(rel: string, base: string): string {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(base)) throw new Error('Path traversal blocked.');
  return resolved;
}

// ─── Tool executor ──────────────────────────────────────────────────────────
async function executeTool(name: string, args: any, workspaceDir: string, socket: Socket): Promise<string> {
  switch (name) {
    case 'execute_command': {
      socket.emit('agent-stream', { type: 'status', content: `Chạy: ${args.command}` });
      return await runShell(args.command, workspaceDir);
    }
    case 'read_file': {
      socket.emit('agent-stream', { type: 'status', content: `Đọc: ${args.relativePath}` });
      const fp = safePath(args.relativePath, workspaceDir);
      if (!fs.existsSync(fp)) return `File not found: ${args.relativePath}`;
      return fs.readFileSync(fp, 'utf8');
    }
    case 'write_file': {
      socket.emit('agent-stream', { type: 'status', content: `Ghi: ${args.relativePath}` });
      const fp = safePath(args.relativePath, workspaceDir);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, args.content, 'utf8');
      return `Đã ghi ${args.content.length} ký tự vào ${args.relativePath}`;
    }
    case 'patch_file': {
      socket.emit('agent-stream', { type: 'status', content: `Vá: ${args.relativePath}` });
      const fp = safePath(args.relativePath, workspaceDir);
      if (!fs.existsSync(fp)) return `File not found: ${args.relativePath}`;
      const content = fs.readFileSync(fp, 'utf8');
      if (!content.includes(args.search)) return `Không tìm thấy đoạn text cần thay thế.`;
      fs.writeFileSync(fp, content.replace(args.search, args.replace), 'utf8');
      return `Đã vá file ${args.relativePath}`;
    }
    case 'git_operations': {
      const cmds: Record<string, string> = {
        status: 'git status', diff: 'git diff', add: 'git add .',
        commit: `git commit -m "${(args.message || 'update').replace(/"/g, '\\"')}"`,
        push: 'git push'
      };
      const cmd = cmds[args.action];
      if (!cmd) return `Unknown git action: ${args.action}`;
      socket.emit('agent-stream', { type: 'status', content: `Git: ${args.action}` });
      return await runShell(cmd, workspaceDir);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Tool schemas (shared) ───────────────────────────────────────────────────
const toolDefinitions = [
  { name: 'execute_command', description: 'Chạy lệnh shell trong workspace.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Lệnh cần chạy' } }, required: ['command'] } },
  { name: 'read_file', description: 'Đọc nội dung file trong workspace.', parameters: { type: 'object', properties: { relativePath: { type: 'string', description: 'Đường dẫn tương đối' } }, required: ['relativePath'] } },
  { name: 'write_file', description: 'Ghi nội dung vào file (tạo mới hoặc ghi đè).', parameters: { type: 'object', properties: { relativePath: { type: 'string', description: 'Đường dẫn tương đối' }, content: { type: 'string', description: 'Nội dung file' } }, required: ['relativePath', 'content'] } },
  { name: 'patch_file', description: 'Thay thế một đoạn text trong file.', parameters: { type: 'object', properties: { relativePath: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['relativePath', 'search', 'replace'] } },
  { name: 'git_operations', description: 'Thực hiện lệnh git.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'diff', 'add', 'commit', 'push'] }, message: { type: 'string' } }, required: ['action'] } },
];

// ─── Gemini native runner ─────────────────────────────────────────────────────
async function runAgentGemini(prompt: string, socket: Socket, workspaceDir: string, apiKey: string, customModel?: string) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai' as any);
  const genAI = new GoogleGenerativeAI(apiKey);

  const tools = [{
    functionDeclarations: toolDefinitions.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }))
  }];

  const GEMINI_MODELS = customModel ? [customModel] : [
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
  ];

  let model: any = null;
  let usedModel = '';
  const errors: string[] = [];

  for (const modelName of GEMINI_MODELS) {
    try {
      const testModel = genAI.getGenerativeModel({ model: modelName });
      await testModel.generateContent('hi');
      model = genAI.getGenerativeModel({
        model: modelName,
        tools,
        systemInstruction: `Bạn là Antigravity Agent — trợ lý lập trình chuyên nghiệp. Hãy viết code hoàn chỉnh, chạy được. Luôn dùng công cụ để thực hiện thay đổi thực tế trên file.`
      });
      usedModel = modelName;
      socket.emit('agent-stream', { type: 'status', content: `Dùng model: ${modelName}` });
      break;
    } catch (e: any) {
      const errMsg = e.message || String(e);
      errors.push(`${modelName}: ${errMsg}`);
      console.log(`Model ${modelName} failed: ${errMsg}, trying next...`);
      continue;
    }
  }

  if (!model) {
    socket.emit('agent-stream', { 
      type: 'error', 
      content: `Không thể kết nối đến Gemini. Chi tiết lỗi:\n${errors.join('\n')}\n\nVui lòng kiểm tra lại tính chính xác của API Key hoặc khu vực địa lý.` 
    });
    return;
  }

  const history: any[] = [];
  const chat = model.startChat({ history });

  const maxLoops = 10;
  let currentLoop = 0;
  let currentPrompt = prompt;

  while (currentLoop < maxLoops) {
    currentLoop++;
    socket.emit('agent-stream', { type: 'status', content: 'Đang suy nghĩ...' });

    try {
      const result = await chat.sendMessage(currentPrompt);
      const response = result.response;
      const candidates = response.candidates || [];
      if (!candidates.length) break;

      const parts = candidates[0].content?.parts || [];
      let hasToolCall = false;
      const toolResults: any[] = [];

      for (const part of parts) {
        if (part.text) {
          socket.emit('agent-stream', { type: 'text', content: part.text });
        }
        if (part.functionCall) {
          hasToolCall = true;
          const { name, args } = part.functionCall;
          socket.emit('agent-stream', { type: 'tool-start', tool: name, input: args });
          try {
            const result = await executeTool(name, args, workspaceDir, socket);
            socket.emit('agent-stream', { type: 'tool-end', tool: name, result });
            toolResults.push({ functionResponse: { name, response: { result } } });
          } catch (e: any) {
            const errMsg = `Tool error: ${e.message}`;
            socket.emit('agent-stream', { type: 'tool-end', tool: name, result: errMsg });
            toolResults.push({ functionResponse: { name, response: { error: errMsg } } });
          }
        }
      }

      if (!hasToolCall) break;

      // Send tool results back
      currentPrompt = toolResults as any;

    } catch (error: any) {
      console.error('Gemini agent error:', error.message);
      socket.emit('agent-stream', { type: 'error', content: `Lỗi: ${error.message}` });
      break;
    }
  }
}

// ─── OpenAI runner ─────────────────────────────────────────────────────────
async function runAgentOpenAI(prompt: string, socket: Socket, workspaceDir: string, apiKey: string, customModel?: string) {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const openaiTools = toolDefinitions.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const messages: any[] = [
    { role: 'system', content: `Bạn là Antigravity Agent — trợ lý lập trình chuyên nghiệp. Hãy dùng công cụ để thực hiện thay đổi thực tế. Viết code hoàn chỉnh, chạy được.` },
    { role: 'user', content: prompt }
  ];

  const maxLoops = 10;
  let currentLoop = 0;
  const modelToUse = customModel || 'gpt-4o-mini';

  while (currentLoop < maxLoops) {
    currentLoop++;
    socket.emit('agent-stream', { type: 'status', content: 'Đang suy nghĩ...' });

    try {
      const response = await openai.chat.completions.create({
        model: modelToUse,
        messages,
        tools: openaiTools,
        tool_choice: 'auto'
      });

      const msg = response.choices[0].message;
      messages.push(msg);

      if (msg.content) socket.emit('agent-stream', { type: 'text', content: msg.content });
      if (!msg.tool_calls?.length) break;

      for (const tc of msg.tool_calls) {
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments);
        socket.emit('agent-stream', { type: 'tool-start', tool: name, input: args });
        let toolResult = '';
        try {
          toolResult = await executeTool(name, args, workspaceDir, socket);
        } catch (e: any) {
          toolResult = `Error: ${e.message}`;
        }
        socket.emit('agent-stream', { type: 'tool-end', tool: name, result: toolResult });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
      }

    } catch (error: any) {
      console.error('OpenAI agent error:', error.message);
      socket.emit('agent-stream', { type: 'error', content: `Lỗi: ${error.message}` });
      break;
    }
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────
export async function runAgent(
  prompt: string,
  socket: Socket,
  workspaceDir: string,
  options?: { customKey?: string; provider?: string; model?: string }
) {
  // Determine API key
  let apiKey = options?.customKey || '';
  let provider = options?.provider || '';
  
  if (!apiKey) {
    // Fallback to server env
    apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  }

  if (!apiKey) {
    socket.emit('agent-stream', { 
      type: 'error', 
      content: 'Chưa cấu hình API Key. Vui lòng nhấn vào biểu tượng Cài đặt (răng cưa) ở góc trên khung Chat để nhập API Key của bạn (có thể đăng nhập Google lấy Gemini API Key miễn phí).' 
    });
    socket.emit('agent-stream', { type: 'done' });
    return;
  }

  // Detect provider if not specified
  if (!provider) {
    provider = apiKey.startsWith('AIza') ? 'gemini' : 'openai';
  }

  try {
    if (provider === 'gemini') {
      // Google Gemini key
      await runAgentGemini(prompt, socket, workspaceDir, apiKey, options?.model);
    } else {
      // OpenAI key
      await runAgentOpenAI(prompt, socket, workspaceDir, apiKey, options?.model);
    }
  } catch (err: any) {
    socket.emit('agent-stream', { type: 'error', content: err.message });
  }

  socket.emit('agent-stream', { type: 'status', content: 'Hoàn tất ✓' });
  socket.emit('agent-stream', { type: 'done' });
}
