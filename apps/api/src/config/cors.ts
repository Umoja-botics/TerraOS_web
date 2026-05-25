const LOCAL_WEB_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

export function getAllowedWebOrigins(): string[] {
  const configured = process.env.WEB_URL?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured?.length ? configured : LOCAL_WEB_ORIGINS;
}

export function isWebOriginAllowed(origin?: string): boolean {
  if (!origin) return true;
  return getAllowedWebOrigins().includes(origin);
}

export function checkWebOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) {
  callback(null, isWebOriginAllowed(origin));
}
