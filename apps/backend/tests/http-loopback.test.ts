import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { expect, it } from "vitest";

it("Supertest connects over loopback while preserving the Host header", async () => {
  const first = createServer((req, res) => res.end(req.headers.host));
  try {
    const test = request(first).get("/");
    const address = first.address() as AddressInfo;
    expect(test.url).toContain(process.platform === "darwin" && address.family === "IPv6" ? "[::1]" : "127.0.0.1");
    const response = await test.expect(200);
    expect(response.text).toBe(`127.0.0.1:${address.port}`);
    const custom = await request(first).get("/").set("Host", "demo.localhost:3000").expect(200);
    expect(custom.text).toBe("demo.localhost:3000");
  } finally {
    if (first.listening) await new Promise<void>(resolve => first.close(() => resolve()));
  }
});
