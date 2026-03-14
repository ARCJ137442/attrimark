import type { SSEEventType } from "../core/types";

type SSEClient = {
  controller: ReadableStreamDefaultController;
  documentId: string;
};

const clients: Map<string, SSEClient> = new Map();
let clientIdCounter = 0;

export function createSSEStream(documentId: string): {
  stream: ReadableStream;
  clientId: string;
} {
  const clientId = `sse-${++clientIdCounter}`;

  const stream = new ReadableStream({
    start(controller) {
      clients.set(clientId, { controller, documentId });
      // Send initial connection event
      const data = `event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`;
      controller.enqueue(new TextEncoder().encode(data));
    },
    cancel() {
      clients.delete(clientId);
    },
  });

  return { stream, clientId };
}

export function broadcast(
  documentId: string,
  eventType: SSEEventType,
  data: unknown
) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(message);

  for (const [id, client] of clients) {
    if (client.documentId === documentId) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        clients.delete(id);
      }
    }
  }
}

export function removeClient(clientId: string) {
  const client = clients.get(clientId);
  if (client) {
    try {
      client.controller.close();
    } catch {}
    clients.delete(clientId);
  }
}
