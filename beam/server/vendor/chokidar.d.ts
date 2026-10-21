// The part of chokidar's API that Beam uses. The plugin compiler resolves type imports too, so this
// cannot re-export from the chokidar package, which is only a dev dependency.
export interface ChokidarOptions {
  ignored?: (path: string) => boolean;
  ignoreInitial?: boolean;
  usePolling?: boolean;
  interval?: number;
  binaryInterval?: number;
  awaitWriteFinish?: { stabilityThreshold?: number; pollInterval?: number };
}

export interface FSWatcher {
  on(event: "all", listener: (eventName: string, path: string) => void): this;
  on(event: "error", listener: (error: unknown) => void): this;
  close(): Promise<void>;
}

export function watch(paths: string | string[], options?: ChokidarOptions): FSWatcher;
