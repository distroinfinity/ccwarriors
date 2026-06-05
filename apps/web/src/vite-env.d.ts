/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_EVM_ADDRESS?: string;
  readonly VITE_SOL_ADDRESS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by https://checkout.razorpay.com/v1/checkout.js (lazy-loaded).
interface Window {
  Razorpay?: new (options: Record<string, unknown>) => {
    open: () => void;
    on: (event: string, handler: (resp: unknown) => void) => void;
  };
}
