/// <reference types="vite/client" />

interface KaraokejDesktop {
  pickLibraryFolders: () => Promise<string[]>;
  getApiBaseUrl: () => Promise<string>;
}

interface Window {
  karaokejDesktop?: KaraokejDesktop;
}
