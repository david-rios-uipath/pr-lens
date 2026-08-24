/** Incremental SSE parser: feed it body chunks, it fires once per complete frame. */
export function createSseParser(onEvent: (event: string, data: unknown) => void): { push: (chunk: string) => void } {
  let buffer = "";
  return {
    push(chunk: string): void {
      buffer += chunk;
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1] ?? "message";
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (data !== undefined) {
          onEvent(event, JSON.parse(data));
        }
        boundary = buffer.indexOf("\n\n");
      }
    },
  };
}
