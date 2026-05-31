import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { runAgent } from './agent';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Fallback path resolution that checks CWD first, then __dirname relative paths (dev vs prod dist)
let publicPath = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(publicPath)) {
  publicPath = path.resolve(process.cwd(), 'backend', 'public');
}
if (!fs.existsSync(publicPath)) {
  publicPath = path.resolve(__dirname, 'public');
}
if (!fs.existsSync(publicPath)) {
  publicPath = path.resolve(__dirname, '../public');
}
console.log("Final Selected publicPath:", publicPath);
console.log("publicPath exists?:", fs.existsSync(publicPath));
if (fs.existsSync(publicPath)) {
  console.log("Files in publicPath:", fs.readdirSync(publicPath));
}
app.use(express.static(publicPath));

app.get('/', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`index.html not found at path: ${indexPath}. CWD is: ${process.cwd()}, __dirname is: ${__dirname}`);
  }
});

let WORKSPACE_DIR = process.env.WORKSPACE_PATH
  ? path.resolve(process.cwd(), process.env.WORKSPACE_PATH)
  : path.resolve(process.cwd(), 'workspace');

if (!process.env.WORKSPACE_PATH) {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    WORKSPACE_DIR = path.resolve(process.cwd(), 'backend', 'workspace');
  }
  if (!fs.existsSync(WORKSPACE_DIR)) {
    WORKSPACE_DIR = path.resolve(__dirname, 'workspace');
  }
  if (!fs.existsSync(WORKSPACE_DIR)) {
    WORKSPACE_DIR = path.resolve(__dirname, '../workspace');
  }
}

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}
console.log("Final Selected WORKSPACE_DIR:", WORKSPACE_DIR);

// Ensure path is safe within workspace directory
function getSafePath(reqPath: string): string {
  const resolved = path.resolve(WORKSPACE_DIR, reqPath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error('Access Denied: Path traversal detected.');
  }
  return resolved;
}

// Flat file list for editor navigation
interface FileItem {
  path: string;
  name: string;
  isDirectory: boolean;
}

function listFilesFlat(dir: string, baseDir: string = dir): FileItem[] {
  let results: FileItem[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/');

    if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.expo' || file === '.gemini') {
      return;
    }

    results.push({
      path: relPath,
      name: file,
      isDirectory: stat.isDirectory()
    });

    if (stat && stat.isDirectory()) {
      results = results.concat(listFilesFlat(filePath, baseDir));
    }
  });
  return results;
}

// REST API Endpoints
app.get('/api/files', (req, res) => {
  try {
    const files = listFilesFlat(WORKSPACE_DIR);
    res.json({ files, workspace: WORKSPACE_DIR });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/workspace', (req, res) => {
  try {
    const { path: newPath } = req.body;
    if (!newPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    // Resolve absolute path
    const resolved = path.resolve(newPath);
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: `Directory does not exist: ${newPath}` });
    }
    
    // Verify it is a directory
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    
    WORKSPACE_DIR = resolved;
    console.log("Workspace dynamically switched to:", WORKSPACE_DIR);
    res.json({ success: true, workspace: WORKSPACE_DIR });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/file', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    const safePath = getSafePath(filePath);
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const content = fs.readFileSync(safePath, 'utf8');
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/file', (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'Path and content are required' });
    }
    const safePath = getSafePath(filePath);
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf8');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/create-folder', (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    const safePath = getSafePath(dirPath);
    if (!fs.existsSync(safePath)) {
      fs.mkdirSync(safePath, { recursive: true });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/git-clone', (req, res) => {
  const { repoUrl, username, token, dir } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

  let cloneUrl = repoUrl;
  if (username && token && repoUrl.startsWith('https://')) {
    cloneUrl = repoUrl.replace('https://', `https://${encodeURIComponent(username)}:${encodeURIComponent(token)}@`);
  }

  const targetDir = dir ? path.resolve(WORKSPACE_DIR, dir) : WORKSPACE_DIR;
  const args = ['clone', cloneUrl];
  if (dir) args.push(targetDir);

  const { execSync } = require('child_process');
  try {
    const output = execSync(`git clone "${cloneUrl}"${dir ? ` "${targetDir}"` : ''}`, {
      cwd: WORKSPACE_DIR,
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    res.json({ success: true, output: output || 'Clone thành công!', dir: dir || '' });
  } catch (err: any) {
    const errMsg = (err.stderr || err.stdout || err.message || 'Unknown error')
      .replace(new RegExp(token || 'TOKEN_PLACEHOLDER', 'g'), '***');
    res.json({ success: false, output: errMsg });
  }
});

// Git info: branch + tracking + changedFiles + log
app.get('/api/git/info', (req, res) => {
  const { execSync } = require('child_process');
  try {
    let branch = 'unknown';
    let tracking = 'none';
    let commits: any[] = [];
    let remoteUrl = '';
    let changedFiles: any[] = [];
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: WORKSPACE_DIR, encoding: 'utf8', timeout: 5000 }).trim();
    } catch {}
    try {
      tracking = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', { cwd: WORKSPACE_DIR, encoding: 'utf8', timeout: 5000 }).trim();
    } catch {
      tracking = branch !== 'unknown' ? `origin/${branch}` : 'none';
    }
    try {
      remoteUrl = execSync('git remote get-url origin', { cwd: WORKSPACE_DIR, encoding: 'utf8', timeout: 5000 }).trim();
    } catch {}
    try {
      const statusRaw = execSync('git status --porcelain', { cwd: WORKSPACE_DIR, encoding: 'utf8', timeout: 5000 }).trim();
      changedFiles = statusRaw.split('\n').filter(Boolean).map((line: string) => {
        const status = line.substring(0, 2).trim();
        const path = line.substring(3).trim();
        return { status, path };
      });
    } catch {}
    try {
      const logRaw = execSync(
        'git log --pretty=format:"%H|%an|%ae|%ar|%s" -20',
        { cwd: WORKSPACE_DIR, encoding: 'utf8', timeout: 5000 }
      ).trim();
      commits = logRaw.split('\n').filter(Boolean).map((line: string) => {
        const [hash, author, email, date, ...msgParts] = line.split('|');
        return { hash: hash?.substring(0, 7), author, email, date, message: msgParts.join('|') };
      });
    } catch {}
    res.json({ branch, tracking, remoteUrl, changedFiles, commits });
  } catch (err: any) {
    res.json({ branch: 'unknown', tracking: 'none', commits: [], changedFiles: [], error: err.message });
  }
});

// Git commit & push helper
app.post('/api/git/commit-push', (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Commit message is required' });
  }
  const { execSync } = require('child_process');
  try {
    // Add all changes
    execSync('git add .', { cwd: WORKSPACE_DIR, timeout: 15000 });
    // Commit
    const commitOut = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: WORKSPACE_DIR, encoding: 'utf8', timeout: 15000 });
    // Push
    const pushOut = execSync('git push', { cwd: WORKSPACE_DIR, encoding: 'utf8', timeout: 45000 });
    res.json({ success: true, commit: commitOut, push: pushOut });
  } catch (err: any) {
    const errMsg = (err.stderr || err.stdout || err.message || 'Unknown error');
    res.json({ success: false, error: errMsg });
  }
});

// PTY Emulation & Fallback
let ptySupported = process.env.USE_NODE_PTY !== 'false';
let ptyModule: any = null;
if (ptySupported) {
  try {
    ptyModule = require('node-pty');
  } catch (e) {
    console.warn("WARNING: node-pty failed to load. Falling back to custom subprocess wrapper.");
    ptySupported = false;
  }
} else {
  console.log("node-pty is disabled by configuration. Using custom subprocess wrapper fallback.");
}

class FallbackPty {
  private proc: any;
  private onDataCallback: ((data: string) => void) | null = null;
  private onExitCallback: ((data: { exitCode: number }) => void) | null = null;

  constructor(shell: string, args: string[], options: any) {
    const isWin = process.platform === 'win32';
    // On Windows fallback we spawn powershell/cmd with shell: true
    this.proc = spawn(shell, args, {
      cwd: options.cwd,
      env: options.env,
      shell: isWin ? true : undefined
    });

    this.proc.stdout.on('data', (data: Buffer) => {
      if (this.onDataCallback) this.onDataCallback(data.toString());
    });

    this.proc.stderr.on('data', (data: Buffer) => {
      if (this.onDataCallback) this.onDataCallback(data.toString());
    });

    this.proc.on('exit', (code: number) => {
      if (this.onExitCallback) this.onExitCallback({ exitCode: code ?? 0 });
    });
  }

  onData(cb: (data: string) => void) {
    this.onDataCallback = cb;
    return { dispose: () => { this.onDataCallback = null; } };
  }

  onExit(cb: (data: { exitCode: number; signal?: number }) => void) {
    this.onExitCallback = cb;
    return { dispose: () => { this.onExitCallback = null; } };
  }

  write(data: string) {
    if (this.proc.stdin.writable) {
      this.proc.stdin.write(data);
    }
  }

  resize(cols: number, rows: number) {
    // Fallback does not support pty resizing
  }

  kill() {
    this.proc.kill();
  }
}

function spawnPty(cwd: string) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : 'bash';
  const args = isWindows ? [] : ['-i'];

  if (ptySupported && ptyModule) {
    try {
      return ptyModule.spawn(shell, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: cwd,
        env: process.env as any
      });
    } catch (err) {
      console.error("node-pty spawn failed, falling back:", err);
    }
  }

  return new FallbackPty(shell, args, {
    cwd: cwd,
    env: process.env
  });
}

// WebSocket Connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create individual PTY for terminal session
  const term = spawnPty(WORKSPACE_DIR);

  // Send terminal data to client
  const dataSub = term.onData((data: string) => {
    socket.emit('terminal-data', data);
  });

  // Client sent keys to PTY
  socket.on('terminal-input', (data: string) => {
    term.write(data);
  });

  // Client resized terminal window
  socket.on('terminal-resize', (size: { cols: number; rows: number }) => {
    term.resize(size.cols, size.rows);
  });

  // AI Agent prompt handler
  socket.on('agent-prompt', async (prompt: string) => {
    console.log(`Agent prompt received: ${prompt}`);
    try {
      await runAgent(prompt, socket, WORKSPACE_DIR);
    } catch (error: any) {
      socket.emit('agent-stream', { type: 'error', content: error.message });
      socket.emit('agent-stream', { type: 'done' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    dataSub.dispose();
    term.kill();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0' as any, () => {
  console.log(`Workspace Server running on http://0.0.0.0:${PORT}`);
});
