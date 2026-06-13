import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { app, shell, type BrowserWindow, type IpcMain } from 'electron';
import { getSettingsStore } from './settings';
import { clearSetupPending, readSetupPending } from './setupPending';
import type {
  AiHealthReport,
  BootstrapOptions,
  BootstrapResult,
  InstallOllamaResult,
  PullModelResult,
  SetupPending,
} from './aiLauncherTypes';

const execFileAsync = promisify(execFile);

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';
const DEFAULT_MODEL = 'rawgraded-local';
const BASE_VISION_MODEL = 'llama3.2-vision';

let pullProcess: ChildProcess | null = null;

function modelMatches(available: string[], wanted: string): boolean {
  const w = wanted.split(':')[0].toLowerCase();
  return available.some((m) => {
    const base = m.split(':')[0].toLowerCase();
    return base === w || m.toLowerCase().startsWith(`${w}:`);
  });
}

async function resolveOllamaPath(): Promise<string | null> {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    path.join(localAppData, 'Programs', 'Ollama', 'ollama app.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const { stdout } = await execFileAsync('where', ['ollama'], {
      shell: true,
      windowsHide: true,
    });
    const first = stdout.trim().split(/\r?\n/)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* not on PATH */
  }
  return null;
}

function resolveBundledOllamaSetup(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'installer-assets', 'OllamaSetup.exe'),
    path.join(app.getAppPath(), 'installer-assets', 'OllamaSetup.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function fetchOllamaTags(baseUrl: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models || []).map((m) => m.name);
    return { ok: true, models };
  } catch (err: unknown) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function buildHealthReport(
  overrides?: { baseUrl?: string; model?: string; provider?: 'gemini' | 'ollama' }
): Promise<AiHealthReport> {
  const store = getSettingsStore();
  const provider = overrides?.provider ?? store.get('llmProvider');
  const baseUrl = overrides?.baseUrl ?? store.get('ollamaBaseUrl') ?? 'http://127.0.0.1:11434';
  const model = overrides?.model ?? store.get('ollamaModel') ?? DEFAULT_MODEL;
  const geminiKey = store.get('geminiApiKey') || '';

  const ollamaPath = await resolveOllamaPath();
  const installed = Boolean(ollamaPath);
  const tags = await fetchOllamaTags(baseUrl);
  const running = tags.ok;
  const modelPresent = running && modelMatches(tags.models, model);

  const gemini = { configured: Boolean(geminiKey.trim()) };
  const ollama = {
    installed,
    running,
    modelPresent,
    models: tags.models,
    ollamaPath: ollamaPath || undefined,
    error: !running ? tags.error : undefined,
  };

  const ready =
    provider === 'gemini' ? gemini.configured : installed && running && modelPresent;

  return { provider, gemini, ollama, ready };
}

async function runWingetInstall(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'winget',
      [
        'install',
        '-e',
        '--id',
        'Ollama.Ollama',
        '--accept-package-agreements',
        '--accept-source-agreements',
      ],
      { shell: true, windowsHide: false }
    );
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => {
      resolve({ ok: false, message: err.message });
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, message: 'Ollama installed via winget.' });
      else resolve({ ok: false, message: out.slice(-500) || `winget exited ${code}` });
    });
  });
}

async function pollUntilInstalled(maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await resolveOllamaPath()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return Boolean(await resolveOllamaPath());
}

async function installOllamaFromBundle(): Promise<InstallOllamaResult> {
  const setupPath = resolveBundledOllamaSetup();
  if (!setupPath) {
    return { ok: false, method: 'manual', message: 'Bundled Ollama installer not found.' };
  }

  return new Promise((resolve) => {
    const child = spawn(
      setupPath,
      ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'],
      { windowsHide: true }
    );
    child.on('error', (err) => {
      resolve({ ok: false, method: 'manual', message: err.message });
    });
    child.on('close', async (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          method: 'manual',
          message: `Ollama installer exited with code ${code}.`,
        });
        return;
      }
      const installed = await pollUntilInstalled(90000);
      if (installed) {
        resolve({ ok: true, method: 'bundled', message: 'Ollama installed from bundled setup.' });
      } else {
        resolve({
          ok: false,
          method: 'bundled',
          message: 'Install finished but Ollama was not detected yet. Start Ollama from the Start menu, then Retry.',
        });
      }
    });
  });
}

async function installOllamaInternal(): Promise<InstallOllamaResult> {
  const existing = await resolveOllamaPath();
  if (existing) {
    return { ok: true, method: 'already', message: 'Ollama is already installed.' };
  }

  const bundled = await installOllamaFromBundle();
  if (bundled.ok) return bundled;

  const winget = await runWingetInstall();
  if (winget.ok) {
    const installed = await pollUntilInstalled(90000);
    if (installed) {
      return { ok: true, method: 'winget', message: 'Ollama installed successfully.' };
    }
    return {
      ok: false,
      method: 'winget',
      message: 'Install finished but Ollama was not detected yet. Start Ollama from the Start menu, then Retry.',
    };
  }

  await shell.openExternal(OLLAMA_DOWNLOAD_URL);
  return {
    ok: false,
    method: 'manual',
    message: `Could not install automatically (${winget.message}). Opened the Ollama download page — install it, then click Retry.`,
  };
}

async function pollOllamaRunning(baseUrl: string, maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const tags = await fetchOllamaTags(baseUrl);
    if (tags.ok) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function ensureOllamaRunningInternal(): Promise<{ ok: boolean; message: string }> {
  const store = getSettingsStore();
  const baseUrl = store.get('ollamaBaseUrl') ?? 'http://127.0.0.1:11434';
  const tags = await fetchOllamaTags(baseUrl);
  if (tags.ok) return { ok: true, message: 'Ollama is running.' };

  const ollamaPath = await resolveOllamaPath();
  if (!ollamaPath) {
    return { ok: false, message: 'Ollama is not installed.' };
  }

  try {
    spawn(ollamaPath, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    const ready = await pollOllamaRunning(baseUrl, 60000);
    if (ready) return { ok: true, message: 'Started Ollama.' };
    return {
      ok: false,
      message: 'Could not reach Ollama after 60s. Open the Ollama app from the Start menu, then Retry.',
    };
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function assessBootstrapNeeds(opts?: BootstrapOptions): Promise<BootstrapOptions> {
  const pending = readSetupPending();
  const store = getSettingsStore();
  const model = opts?.model ?? pending?.model ?? store.get('ollamaModel') ?? DEFAULT_MODEL;
  const baseUrl = store.get('ollamaBaseUrl') ?? 'http://127.0.0.1:11434';
  const ollamaPath = await resolveOllamaPath();
  const installed = Boolean(ollamaPath);
  const tags = await fetchOllamaTags(baseUrl);
  const running = tags.ok;
  const modelPresent = running && modelMatches(tags.models, model);

  const wantInstall = opts?.installOllama ?? pending?.installOllama ?? true;
  const wantPull = opts?.pullModel ?? pending?.pullModel ?? true;

  return {
    installOllama: wantInstall && !installed,
    pullModel: wantPull && (!running || !modelPresent),
    model,
  };
}

function pullModelWithProgress(
  model: string,
  win: BrowserWindow | null
): Promise<PullModelResult> {
  return new Promise(async (resolve) => {
    const ollamaPath = await resolveOllamaPath();
    if (!ollamaPath) {
      resolve({ ok: false, message: 'Install Ollama first.' });
      return;
    }

    if (pullProcess) {
      resolve({ ok: false, message: 'A model download is already in progress.' });
      return;
    }

    pullProcess = spawn(ollamaPath, ['pull', model], {
      shell: false,
      windowsHide: true,
    });

    const send = (line: string, done?: boolean, error?: boolean) => {
      win?.webContents.send('ai:pullProgress', { line, done, error });
    };

    pullProcess.stdout?.on('data', (d) => send(d.toString(), false, false));
    pullProcess.stderr?.on('data', (d) => send(d.toString(), false, false));
    pullProcess.on('error', (err) => {
      pullProcess = null;
      send(err.message, true, true);
      resolve({ ok: false, message: err.message });
    });
    pullProcess.on('close', (code) => {
      pullProcess = null;
      if (code === 0) {
        send('Download complete.', true, false);
        resolve({ ok: true, message: `Model ${model} is ready.` });
      } else {
        send(`Pull failed (exit ${code}).`, true, true);
        resolve({ ok: false, message: `Failed to pull ${model}.` });
      }
    });
  });
}

function resolveModelfilePath(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'models', 'rawgraded-local', 'Modelfile'),
    path.join(app.getAppPath(), 'models', 'rawgraded-local', 'Modelfile'),
    path.join(process.cwd(), 'models', 'rawgraded-local', 'Modelfile'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function createRawgradedLocalModel(
  modelfilePath: string,
  win: BrowserWindow | null
): Promise<{ ok: boolean; message: string }> {
  const ollamaPath = await resolveOllamaPath();
  if (!ollamaPath) {
    return { ok: false, message: 'Ollama not found — cannot create rawgraded-local.' };
  }
  return new Promise((resolve) => {
    const proc = spawn(ollamaPath, ['create', DEFAULT_MODEL, '-f', modelfilePath], {
      windowsHide: true,
      shell: false,
    });
    let output = '';
    const send = (line: string) => {
      output += line;
      win?.webContents.send('ai:pullProgress', { line, done: false, error: false });
    };
    proc.stdout?.on('data', (d) => send(d.toString()));
    proc.stderr?.on('data', (d) => send(d.toString()));
    proc.on('error', (err) => resolve({ ok: false, message: err.message }));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, message: `${DEFAULT_MODEL} created from Modelfile.` });
      } else {
        resolve({ ok: false, message: `Failed to create ${DEFAULT_MODEL}: ${output.slice(-200)}` });
      }
    });
  });
}

function emitBootstrapProgress(win: BrowserWindow | null, line: string): void {
  win?.webContents.send('ai:pullProgress', { line: `${line}\n`, done: false, error: false });
}

export async function runBootstrapPipeline(
  opts: BootstrapOptions,
  win: BrowserWindow | null
): Promise<BootstrapResult> {
  const store = getSettingsStore();
  const assessed = await assessBootstrapNeeds(opts);
  const installOllama = assessed.installOllama === true;
  const pullModel = assessed.pullModel === true;

  if (!installOllama && !pullModel) {
    const report = await buildHealthReport({ provider: 'ollama' });
    if (report.ready) {
      store.set('llmProvider', 'ollama');
      store.set('bootstrapComplete', true);
      clearSetupPending();
      emitBootstrapProgress(win, 'Local AI is already ready.');
      win?.webContents.send('ai:pullProgress', { line: '', done: true, error: false });
      return { ok: true, message: 'Bootstrap skipped — Ollama already ready.' };
    }
  }

  if (installOllama) {
    emitBootstrapProgress(win, 'Installing Ollama…');
    const installResult = await installOllamaInternal();
    emitBootstrapProgress(win, installResult.message);
    if (!installResult.ok && installResult.method === 'manual') {
      return { ok: false, message: installResult.message };
    }
  }

  emitBootstrapProgress(win, 'Starting Ollama service…');
  const runResult = await ensureOllamaRunningInternal();
  emitBootstrapProgress(win, runResult.message);
  if (!runResult.ok) {
    return { ok: false, message: runResult.message };
  }

  if (pullModel) {
    emitBootstrapProgress(win, `Downloading ${BASE_VISION_MODEL}…`);
    const basePull = await pullModelWithProgress(BASE_VISION_MODEL, win);
    if (!basePull.ok) {
      return { ok: false, message: basePull.message };
    }

    const modelfile = resolveModelfilePath();
    if (modelfile) {
      emitBootstrapProgress(win, 'Creating rawgraded-local model…');
      const createResult = await createRawgradedLocalModel(modelfile, win);
      emitBootstrapProgress(win, createResult.message);
      if (!createResult.ok) {
        return { ok: false, message: createResult.message };
      }
    } else {
      emitBootstrapProgress(win, 'Modelfile not found — using base vision model. Run: ollama create rawgraded-local -f models\\rawgraded-local\\Modelfile');
    }
  }

  const finalModel = resolveModelfilePath() ? DEFAULT_MODEL : BASE_VISION_MODEL;

  store.set('llmProvider', 'ollama');
  store.set('ollamaModel', finalModel);
  store.set('bootstrapComplete', true);
  store.set('installerChoseOllama', true);
  clearSetupPending();

  emitBootstrapProgress(win, 'Local AI is ready.');
  win?.webContents.send('ai:pullProgress', { line: '', done: true, error: false });

  return { ok: true, message: 'Bootstrap complete.' };
}

export function registerAiLauncherIpc(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('ai:healthCheck', async (_e, overrides?: { baseUrl?: string; model?: string; provider?: 'gemini' | 'ollama' }) => {
    return buildHealthReport(overrides);
  });

  ipcMain.handle('ai:getSetupPending', (): SetupPending | null => readSetupPending());

  ipcMain.handle('ai:clearSetupPending', () => {
    clearSetupPending();
    return { ok: true };
  });

  ipcMain.handle('ai:markBootstrapComplete', () => {
    const store = getSettingsStore();
    store.set('bootstrapComplete', true);
    clearSetupPending();
    return { ok: true };
  });

  ipcMain.handle('ai:runBootstrap', async (_e, opts?: BootstrapOptions) => {
    const pending = readSetupPending();
    const merged: BootstrapOptions = {
      installOllama: opts?.installOllama ?? pending?.installOllama ?? true,
      pullModel: opts?.pullModel ?? pending?.pullModel ?? true,
      model: opts?.model ?? pending?.model,
    };
    return runBootstrapPipeline(merged, getMainWindow());
  });

  ipcMain.handle('ai:installOllama', async (): Promise<InstallOllamaResult> => {
    return installOllamaInternal();
  });

  ipcMain.handle('ai:openOllamaDownload', async () => {
    await shell.openExternal(OLLAMA_DOWNLOAD_URL);
    return { ok: true };
  });

  ipcMain.handle('ai:ensureOllamaRunning', async () => {
    return ensureOllamaRunningInternal();
  });

  ipcMain.handle('ai:pullModel', async (_e, modelName?: string) => {
    const store = getSettingsStore();
    const model = modelName || store.get('ollamaModel') || DEFAULT_MODEL;
    return pullModelWithProgress(model, getMainWindow());
  });
}
