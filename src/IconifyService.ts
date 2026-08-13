// Why: Centralizes all Iconify API interaction and caching to keep Svelte components pure-presentational
const ICONIFY_API = "https://api.iconify.design";
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

// Why: Hand-drawn help-circle SVG used as fallback when fetch fails or icon name is invalid
const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

export async function resolveIconifyIcon(iconStr: string): Promise<string> {
    // Parse "iconify:prefix:name" format
    const parts = iconStr.split(":");
    if (parts.length !== 3) return FALLBACK_SVG;
    const prefix = parts[1];
    const name = parts[2];
    const cacheKey = `${prefix}:${name}`;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // Why: Deduplicates concurrent requests for the same icon to avoid redundant network calls
    const existing = inflight.get(cacheKey);
    if (existing) return existing;

    const promise = fetchAndCache(prefix, name, cacheKey);
    inflight.set(cacheKey, promise);

    try {
        return await promise;
    } finally {
        inflight.delete(cacheKey);
    }
}

async function fetchAndCache(prefix: string, name: string, cacheKey: string): Promise<string> {
    try {
        const url = `${ICONIFY_API}/${prefix}.json?icons=${name}`;
        const resp = await fetch(url);
        if (!resp.ok) return FALLBACK_SVG;

        const data = await resp.json();
        const iconData = data?.icons?.[name];
        if (!iconData?.body) return FALLBACK_SVG;

        // Why: width/height may live on individual icon or at set root level as defaults
        const width = iconData.width ?? data.width ?? 24;
        const height = iconData.height ?? data.height ?? 24;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="currentColor">${iconData.body}</svg>`;

        cache.set(cacheKey, svg);
        return svg;
    } catch {
        return FALLBACK_SVG;
    }
}
