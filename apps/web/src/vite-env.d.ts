/// <reference types="vite/client" />

interface KaraokejDesktop {
  pickLibraryFolders: () => Promise<string[]>;
  getApiBaseUrl: () => Promise<string>;
  openContainingFolder: (filePath: string) => Promise<string | null>;
}

interface Window {
  karaokejDesktop?: KaraokejDesktop;
}
