import { createServer } from "node:http";
import request from "supertest";
import { expect, it } from "vitest";

it("uses IPv4 for temporary test servers on Linux", async () => {
  const platform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    const server = createServer((_req, res) => res.end("ok"));
    const test = request(server).get("/");
    expect(test.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    await test.expect(200, "ok");
    expect(server.listening).toBe(false);
  } finally {
    Object.defineProperty(process, "platform", { value: platform });
  }
});
