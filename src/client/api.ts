const BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  if (res.status === 204) return null as T;

  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Request failed"), { status: res.status, data });
  return data;
}

// Documents
export const listDocuments = () => request<any[]>("GET", "/documents");
export const getDocument = (id: string) => request<any>("GET", `/documents/${id}`);
export const createDocument = (title: string) => request<any>("POST", "/documents", { title });
export const deleteDocument = (id: string) => request<void>("DELETE", `/documents/${id}`);

// Blocks
export const listBlocks = (docId: string) => request<any[]>("GET", `/documents/${docId}/blocks`);

export const createBlock = (docId: string, content: string, position?: number) =>
  request<any>("POST", `/documents/${docId}/blocks`, {
    content,
    author: { type: "human" },
    position,
  });

export const updateBlock = (docId: string, blockId: string, content: string, version: number) =>
  request<any>("PUT", `/documents/${docId}/blocks/${blockId}`, {
    content,
    author: { type: "human" },
    version,
  });

export const patchBlock = (docId: string, blockId: string, oldStr: string, newStr: string, version: number) =>
  request<any>("PATCH", `/documents/${docId}/blocks/${blockId}`, {
    old: oldStr,
    new: newStr,
    author: { type: "human" },
    version,
  });

export const deleteBlockApi = (docId: string, blockId: string, version: number) =>
  request<void>("DELETE", `/documents/${docId}/blocks/${blockId}`, { version });

// Split / Merge
export const splitBlock = (docId: string, blockId: string, position: number, version: number) =>
  request<any>("POST", `/documents/${docId}/blocks/${blockId}/split`, { position, version });

export const mergeBlocks = (docId: string, sourceId: string, targetId: string, sourceVersion: number, targetVersion: number) =>
  request<any>("POST", `/documents/${docId}/blocks/${sourceId}/merge`, {
    targetBlockId: targetId,
    version: sourceVersion,
    targetVersion,
    author: { type: "human" },
  });

// Stats
export const getStats = (docId: string) => request<any>("GET", `/documents/${docId}/stats`);

// Export
export const exportDocument = async (docId: string, format: "md" | "full") => {
  const res = await fetch(`${BASE}/documents/${docId}/export?format=${format}`);
  if (!res.ok) throw new Error("Export failed");
  if (format === "md") return res.text();
  return res.json();
};

// Import
export const importDocument = (markdown: string, defaultSource?: string, provenance?: any) =>
  request<any>("POST", "/documents/import", { markdown, defaultSource, provenance });
