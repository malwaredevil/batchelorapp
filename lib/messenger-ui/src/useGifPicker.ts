export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
}

interface GifResponse {
  results: GifResult[];
}

async function fetchGifs(path: string): Promise<GifResult[]> {
  const resp = await fetch(path);
  if (!resp.ok) {
    const body = (await resp.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `GIF request failed (${resp.status})`);
  }
  const json = (await resp.json()) as GifResponse;
  return json.results;
}

export function fetchTrendingGifs(): Promise<GifResult[]> {
  return fetchGifs("/api/messenger/gifs/trending?limit=24");
}

export function searchGifs(query: string): Promise<GifResult[]> {
  return fetchGifs(
    `/api/messenger/gifs/search?limit=24&q=${encodeURIComponent(query)}`,
  );
}

/**
 * Turn a picked GIF into a real messenger attachment: the server fetches the
 * bytes itself and stores them in the messenger bucket, returning the same
 * shape the file-upload endpoint does so it can be dropped straight into
 * `pendingAttachments`.
 */
export async function createGifAttachment(gif: GifResult): Promise<{
  storagePath: string;
  url: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}> {
  const resp = await fetch("/api/messenger/attachments/from-gif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: gif.url, title: gif.title }),
  });
  if (!resp.ok) {
    const body = (await resp.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Could not add GIF (${resp.status})`);
  }
  return resp.json();
}
