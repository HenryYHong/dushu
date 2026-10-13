export function ensureModelService(options?: {
  fetcher?: typeof fetch;
  launch?: () => Promise<boolean>;
  wait?: (milliseconds: number) => Promise<void>;
  report?: (message: string) => void;
}): Promise<boolean>;
