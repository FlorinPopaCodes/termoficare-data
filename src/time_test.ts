import { assertEquals } from "@std/assert";
import { formatBucharest } from "./time.ts";

Deno.test("winter: UTC+2, no DST", () => {
  assertEquals(formatBucharest(new Date("2026-01-15T10:00:00Z")), "2026-01-15T12:00:00");
});

Deno.test("summer: UTC+3 DST", () => {
  assertEquals(formatBucharest(new Date("2026-07-15T10:00:00Z")), "2026-07-15T13:00:00");
});

Deno.test("midnight does not render as hour 24", () => {
  assertEquals(formatBucharest(new Date("2026-01-14T22:00:00Z")), "2026-01-15T00:00:00");
});
