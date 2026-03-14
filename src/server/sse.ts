import type { SSEEventType } from "../core/types";

type SSEClient = {
  writer: WritableStreamDefaultWriter;
  documentId: string;
  heartbeat: ReturnType<typeof setInterval>;
};

const encoder = new TextEncoder();
const clients: Map<string, SSEClient> = new Map();
let clientIdCounter = 0;

function cleanup(clientId: string) {
  const client = clients.get(clientId);
  if (client) {
    clearInterval(client.heartbeat);
    clients.delete(clientId);
  }
}

function safeWrite(clientId: string, writer: WritableStreamDefaultWriter, data: Uint8Array) {
  writer.write(data).catch(() => cleanup(clientId));
}

export function createSSEResponse(documentId: string): Response {
  const clientId = `sse-${++clientIdCounter}`;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Send initial event
  safeWrite(clientId, writer,
    encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`)
  );

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    safeWrite(clientId, writer, encoder.encode(`: heartbeat\n\n`));
  }, 15000);

  clients.set(clientId, { writer, documentId, heartbeat });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export function broadcast(
  documentId: string,
  eventType: SSEEventType,
  data: unknown
) {
  const message = encoder.encode(
    `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
  );

  for (const [id, client] of clients) {
    if (client.documentId === documentId) {
      safeWrite(id, client.writer, message);
    }
  }
}
