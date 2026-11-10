import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('karaokejDesktop', {
  pickLibraryFolders: (): Promise<string[]> =>
    ipcRenderer.invoke('karaokej:pick-library-folders'),
  getApiBaseUrl: (): Promise<string> =>
    ipcRenderer.invoke('karaokej:get-api-base-url'),
  openContainingFolder: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('karaokej:open-containing-folder', filePath),
});
