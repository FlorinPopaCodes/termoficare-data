import { assertEquals } from "@std/assert";
import { bucharestTimestamp } from "./clock.ts";

Deno.test("a summer instant renders in EEST (UTC+3)", () => {
  assertEquals(bucharestTimestamp(new Date("2026-07-16T12:13:27Z")), "2026-07-16T15:13:27");
});

Deno.test("a winter instant renders in EET (UTC+2)", () => {
  assertEquals(bucharestTimestamp(new Date("2026-02-06T07:32:38Z")), "2026-02-06T09:32:38");
});

Deno.test("midnight renders as 00, not 24", () => {
  assertEquals(bucharestTimestamp(new Date("2026-07-15T21:00:00Z")), "2026-07-16T00:00:00");
});

Deno.test("output shape matches YYYY-MM-DDTHH:MM:SS", () => {
  const ts = bucharestTimestamp(new Date());
  assertEquals(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(ts), true);
});
