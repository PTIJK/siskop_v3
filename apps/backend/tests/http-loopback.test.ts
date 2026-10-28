import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

it("auto-assigned HTTP test ports belong exclusively to the IPv4 loopback listener", async () => {
  const first = createServer();
  const second = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      first.once("error", reject);
      first.listen(0, resolve);
    });
    const address = first.address() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
    await expect(new Promise<void>((resolve, reject) => {
      second.once("error", reject);
      second.listen(address.port, "127.0.0.1", resolve);
    })).rejects.toMatchObject({ code: "EADDRINUSE" });
  } finally {
    if (second.listening) await new Promise<void>(resolve => second.close(() => resolve()));
    if (first.listening) await new Promise<void>(resolve => first.close(() => resolve()));
  }
});
