import "@testing-library/jest-dom";
// Stub window.petcBridge so unit tests don't need Electron
window.petcBridge = {
    getSidecarUrl: () => Promise.resolve("http://127.0.0.1:8765"),
    getUserDataPath: () => Promise.resolve("/tmp/petc-test"),
    openPath: () => Promise.resolve(""),
    onUpdateAvailable: () => () => { },
    onUpdateReady: () => () => { },
    installUpdate: () => { },
    reportFatal: () => { },
};
