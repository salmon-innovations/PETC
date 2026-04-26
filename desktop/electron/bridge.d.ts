/** Type declarations for window.petcBridge — consumed by the renderer. */
interface PetcBridge {
  getSidecarUrl(): Promise<string>;
  getUserDataPath(): Promise<string>;
  openPath(filePath: string): Promise<string>;
  onUpdateAvailable(cb: () => void): () => void;
  onUpdateReady(cb: () => void): () => void;
  installUpdate(): void;
  reportFatal(message: string): void;
}

declare global {
  interface Window {
    petcBridge: PetcBridge;
  }
}

export {};
