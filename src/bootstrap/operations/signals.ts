interface Signals {
  on(name: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(name: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

/** Signal listeners are explicit and removed on both shutdown and failure. */
export async function runEngineHostUntilSignal(host: { close(): Promise<void>; readonly done: Promise<void> }, signals: Signals = process): Promise<void> {
  const close = () => { void host.close().catch(() => undefined); };
  signals.on('SIGINT', close); signals.on('SIGTERM', close);
  try { await host.done; }
  finally { signals.removeListener('SIGINT', close); signals.removeListener('SIGTERM', close); }
}
