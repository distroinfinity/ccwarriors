// HTTP base of the API, derived from the WebSocket URL.
export const API_HTTP = (import.meta.env.VITE_WS_URL ?? "ws://localhost:8787").replace(/^ws/, "http");
