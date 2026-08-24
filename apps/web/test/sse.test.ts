import { describe, expect, it } from "vitest";
import { createSseParser } from "../src/lib/sse";

function collect() {
  const events: { event: string; data: unknown }[] = [];
  const parser = createSseParser((event, data) => events.push({ event, data }));
  return { events, parser };
}

describe("createSseParser", () => {
  it("parses a complete event frame", () => {
    const { events, parser } = collect();
    parser.push('event: progress\ndata: {"stage":"fetch-prs","status":"start"}\n\n');
    expect(events).toEqual([{ event: "progress", data: { stage: "fetch-prs", status: "start" } }]);
  });

  it("handles frames split across chunks", () => {
    const { events, parser } = collect();
    parser.push("event: prog");
    parser.push('ress\ndata: {"a":1}\n');
    expect(events).toEqual([]);
    parser.push("\nevent: report\ndata: {}\n\n");
    expect(events).toEqual([
      { event: "progress", data: { a: 1 } },
      { event: "report", data: {} },
    ]);
  });

  it("parses multiple events in one chunk", () => {
    const { events, parser } = collect();
    parser.push('event: progress\ndata: {"a":1}\n\nevent: progress\ndata: {"a":2}\n\n');
    expect(events.map((e) => e.data)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
