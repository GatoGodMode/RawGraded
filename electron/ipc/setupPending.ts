import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface SetupPending {
  installOllama: boolean;
  pullModel: boolean;
  model: string;
}

const PENDING_DIR = 'rawgraded-studio';
const PENDING_FILE = 'setup-pending.json';

export function getSetupPendingDir(): string {
  const base = process.env.APPDATA || app.getPath('appData');
  return path.join(base, PENDING_DIR);
}

export function getSetupPendingPath(): string {
  return path.join(getSetupPendingDir(), PENDING_FILE);
}

export function readSetupPending(): SetupPending | null {
  const filePath = getSetupPendingPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SetupPending>;
    return {
      installOllama: Boolean(raw.installOllama),
      pullModel: raw.pullModel !== false,
      model: String(raw.model || 'llama3.2-vision'),
    };
  } catch {
    return null;
  }
}

export function clearSetupPending(): void {
  const filePath = getSetupPendingPath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
