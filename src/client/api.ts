const BASE = "/api";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${url}`, opts);
  if (res.status === 204) return null as T;

  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Request failed"), { status: res.status, data });
  return data;
}

function q(path: string): string {
  return `path=${encodeURIComponent(path)}`;
}

// Documents
export const listDocuments = (dir?: string) =>
  request<any[]>("GET", `/documents${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`);
export const getDocument = (path: string) =>
  request<any>("GET", `/documents/detail?${q(path)}`);
export const createDocument = (title: string, path: string) =>
  request<any>("POST", "/documents", { title, path });
export const deleteDocument = (path: string) =>
  request<void>("DELETE", `/documents?${q(path)}`);

// Blocks
export const listBlocks = (path: string) =>
  request<any[]>("GET", `/blocks?${q(path)}`);

export const createBlock = (path: string, content: string, position?: number) =>
  request<any>("POST", `/blocks?${q(path)}`, {
    content,
    author: { type: "human" },
    position,
  });

export const updateBlock = (path: string, blockId: string, content: string, version: number) =>
  request<any>("PUT", `/blocks/${blockId}?${q(path)}`, {
    content,
    author: { type: "human" },
    version,
  });

export const patchBlock = (path: string, blockId: string, oldStr: string, newStr: string, version: number) =>
  request<any>("PATCH", `/blocks/${blockId}?${q(path)}`, {
    old: oldStr,
    new: newStr,
    author: { type: "human" },
    version,
  });

export const deleteBlockApi = (path: string, blockId: string, version: number) =>
  request<void>("DELETE", `/blocks/${blockId}?${q(path)}`, { version });

// Split / Merge
export const splitBlock = (path: string, blockId: string, position: number, version: number) =>
  request<any>("POST", `/blocks/${blockId}/split?${q(path)}`, { position, version });

export const mergeBlocks = (path: string, sourceId: string, targetId: string, sourceVersion: number, targetVersion: number) =>
  request<any>("POST", `/blocks/${sourceId}/merge?${q(path)}`, {
    targetBlockId: targetId,
    version: sourceVersion,
    targetVersion,
    author: { type: "human" },
  });

// Stats
export const getStats = (path: string) => request<any>("GET", `/stats?${q(path)}`);

// Export
export const exportDocument = async (path: string, format: "md" | "full") => {
  const res = await fetch(`${BASE}/export?${q(path)}&format=${format}`);
  if (!res.ok) throw new Error("Export failed");
  if (format === "md") return res.text();
  return res.json();
};

// Import
export const importDocument = (markdown: string, outputPath: string, defaultSource?: string) =>
  request<any>("POST", "/import", { markdown, path: outputPath, defaultSource });
