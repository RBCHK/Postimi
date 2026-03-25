import http from "http";

const MOCK_RESPONSE_TEXT =
  "Here's a strong reply that engages with the original post while adding value to the conversation.";

/**
 * Minimal mock of Anthropic Messages API (streaming).
 * Returns a fixed SSE response for any POST /v1/messages request.
 */
function createSSEStream(): string {
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_mock_001",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-sonnet-4-6",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    })}\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}\n`,
    `event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: MOCK_RESPONSE_TEXT },
    })}\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index: 0,
    })}\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 20 },
    })}\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n`,
  ];
  return events.join("\n");
}

export function startMockAIServer(port = 4567): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200);
        res.end("ok");
      } else if (
        req.method === "POST" &&
        (req.url?.startsWith("/messages") || req.url?.startsWith("/v1/messages"))
      ) {
        // Consume request body
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.end(createSSEStream());
        });
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(port, () => {
      console.log(`[mock-ai] Listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

export const MOCK_AI_RESPONSE = MOCK_RESPONSE_TEXT;
