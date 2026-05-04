/// <reference types="vite/client" />

interface ElectronAPI {
    getSources: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>;
    getAppInfo: () => Promise<{ version: string; name: string; platform: string }>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
