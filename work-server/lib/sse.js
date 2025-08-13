// Simple Server-Sent Events broadcaster

export function createSSE() {
  const clients = new Set();
  let lastSnapshot = null;

  return {
    subscribe(c) {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const safeEnqueue = (chunk) => {
            try { controller.enqueue(encoder.encode(chunk)); } catch (_) { /* stream closed */ }
          };

          // Initial retry hint and open comment to establish stream
          safeEnqueue('retry: 10000\n\n');

          const client = {
            write: (data) => safeEnqueue(`data: ${JSON.stringify(data)}\n\n`),
            close: () => { try { controller.close(); } catch (_) {} },
          };
          clients.add(client);

          // Heartbeat to keep proxies happy
          const pingId = setInterval(() => safeEnqueue(': ping\n\n'), 15000);

          const onAbort = () => {
            clearInterval(pingId);
            clients.delete(client);
            try { controller.close(); } catch (_) {}
          };

          // Use the request AbortSignal to detect disconnects
          try { c.req.raw.signal.addEventListener('abort', onAbort); } catch (_) {}
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    },
    broadcast(data) {
      // Only broadcast if changed (cheap structural compare)
      const serialized = JSON.stringify(data);
      if (serialized === lastSnapshot) {
        return;
      }
      lastSnapshot = serialized;
      for (const client of Array.from(clients)) {
        try { client.write(data); } catch (_) { clients.delete(client); }
      }
    },
  };
}


