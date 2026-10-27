export {};

declare global {
  interface Window {
    inkquayDesktop?: {
      onCloseRequest(callback: () => void): () => void;
      readyToClose(): void;
      cancelClose(): void;
    };
  }
}
