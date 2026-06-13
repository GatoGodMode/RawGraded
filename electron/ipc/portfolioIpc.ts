import type { IpcMain, BrowserWindow } from 'electron';
import {
  listPortfolioCards,
  getPortfolioCard,
  deletePortfolioCard,
  listStaleCardIds,
} from './portfolioDb';
import {
  refreshPortfolioCardPrices,
  refreshPortfolioCardWithPcUrl,
  searchPricechartingUrls,
  createCardFromGrading,
  archivePortfolioCard,
  updatePortfolioProvenance,
} from './pricingService';
import { openMicrosoftEdgeUrls, openExternalUrl } from './shellEdge';
import type { PortfolioListParams } from '../shared/portfolioBridgeTypes';

export function registerPortfolioIpc(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('portfolio:list', (_e, params?: PortfolioListParams) => listPortfolioCards(params || {}));

  ipcMain.handle('portfolio:get', (_e, id: string) => getPortfolioCard(id));

  ipcMain.handle('portfolio:delete', (_e, id: string) => ({ ok: deletePortfolioCard(id) }));

  ipcMain.handle('portfolio:archive', (_e, id: string, archived: boolean) => archivePortfolioCard(id, archived));

  ipcMain.handle('portfolio:updateProvenance', (_e, id: string, provenance: Record<string, unknown>) =>
    updatePortfolioProvenance(id, provenance)
  );

  ipcMain.handle('portfolio:addFromGrading', (_e, input: Parameters<typeof createCardFromGrading>[0]) =>
    createCardFromGrading(input)
  );

  ipcMain.handle('pricing:refreshCard', async (_e, id: string) => refreshPortfolioCardPrices(id));

  ipcMain.handle('pricing:refreshWithPcUrl', async (_e, id: string, url: string) =>
    refreshPortfolioCardWithPcUrl(id, url)
  );

  ipcMain.handle('pricing:searchPriceCharting', async (_e, q: string) => searchPricechartingUrls(q));

  ipcMain.handle('pricing:refreshBatch', async (_e, opts?: { maxAgeMs?: number; ids?: string[] }) => {
    const win = getMainWindow();
    const maxAge = opts?.maxAgeMs ?? 24 * 60 * 60 * 1000;
    const ids = opts?.ids?.length ? opts.ids : listStaleCardIds(maxAge);
    const total = ids.length;
    let index = 0;
    for (const id of ids) {
      index += 1;
      try {
        await refreshPortfolioCardPrices(id);
        win?.webContents.send('portfolio:refreshProgress', { cardId: id, index, total, ok: true });
      } catch (err) {
        win?.webContents.send('portfolio:refreshProgress', {
          cardId: id,
          index,
          total,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ok: true, total };
  });

  ipcMain.handle('shell:openEdge', async (_e, urls: string | string[]) => {
    const arr = Array.isArray(urls) ? urls : [urls];
    return openMicrosoftEdgeUrls(arr);
  });

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await openExternalUrl(url);
    return { ok: true };
  });
}
