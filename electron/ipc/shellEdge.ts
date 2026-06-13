import path from 'path';
import { app, shell } from 'electron';

const ALLOWED_EDGE_HOSTS = [
  'www.ebay.com',
  'ebay.com',
  'm.ebay.com',
  'www.tcgplayer.com',
  'tcgplayer.com',
  'www.pricecharting.com',
  'pricecharting.com',
];

export async function openMicrosoftEdgeUrls(urls: string[]): Promise<{ ok: boolean; opened: number; error?: string }> {
  const arr = urls.map((u) => String(u || '').trim()).filter(Boolean);
  if (!arr.length) return { ok: false, opened: 0, error: 'no-urls' };

  if (process.platform !== 'win32') {
    for (const href of arr) await shell.openExternal(href);
    return { ok: true, opened: arr.length };
  }

  let opened = 0;
  const errs: string[] = [];
  for (const href of arr) {
    try {
      const u = new URL(href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        errs.push(`${href}: unsupported protocol`);
        continue;
      }
      const host = u.hostname.toLowerCase();
      const allowed = ALLOWED_EDGE_HOSTS.some((h) => host === h || host.endsWith(`.${h.replace(/^www\./, '')}`));
      if (!allowed) {
        errs.push(`${href}: host not allowed`);
        continue;
      }
      await shell.openExternal(`microsoft-edge:${u.href}`);
      opened += 1;
    } catch (e) {
      errs.push(`${href}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: opened > 0, opened, error: errs.length ? errs.join('; ') : undefined };
}

export async function openExternalUrl(url: string): Promise<void> {
  const href = String(url || '').trim();
  if (href) await shell.openExternal(href);
}

export function configurePlaywrightBrowsersPath(): void {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'playwright-browsers');
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundled;
  }
}
