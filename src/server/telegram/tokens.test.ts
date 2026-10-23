import { describe, expect, it } from "vitest";

import { MS_PER_HOUR } from "@/domain";

import { createGroupLinkToken, createHostLinkToken } from "./links";
import { advance, setup } from "./setup.test-helpers";
import { consumeLinkToken, createLinkToken, hashToken, parseStartPayload } from "./tokens";

describe("link tokens", () => {
  it("host link is a t.me deep link whose token is stored only as a sha256 hash", async () => {
    const w = setup();
    const url = await createHostLinkToken(w.hostId, w.deps);
    const match = /^https:\/\/t\.me\/settlelah_bot\?start=host_([A-Za-z0-9_-]{43})$/.exec(url);
    expect(match).not.toBeNull();
    const token = match![1];
    const rows = w.db.table("telegram_link_tokens");
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
    expect(rows[0].kind).toBe("host");
    expect(rows[0].expires_at).toBe(new Date(w.clock.now.getTime() + 24 * MS_PER_HOUR).toISOString());
  });

  it("group link uses ?startgroup=grp_", async () => {
    const w = setup();
    const url = await createGroupLinkToken(w.hostId, w.deps);
    expect(url).toMatch(/^https:\/\/t\.me\/settlelah_bot\?startgroup=grp_[A-Za-z0-9_-]{43}$/);
    expect(parseStartPayload(url.split("startgroup=")[1])).toEqual({ kind: "group", token: url.split("grp_")[1] });
  });

  it("host/group tokens are single use and the second consumer gets null", async () => {
    const w = setup();
    const token = await createLinkToken(w.deps.db, w.hostId, "host", { now: w.clock.now });
    const first = await consumeLinkToken(w.deps.db, "host", token, w.clock.now);
    expect(first?.hostId).toBe(w.hostId);
    expect(await consumeLinkToken(w.deps.db, "host", token, w.clock.now)).toBeNull();
  });

  it("tokens expire after 24h and cannot be used for a different kind", async () => {
    const w = setup();
    const token = await createLinkToken(w.deps.db, w.hostId, "group", { now: w.clock.now });
    expect(await consumeLinkToken(w.deps.db, "host", token, w.clock.now)).toBeNull();
    advance(w, 24 * MS_PER_HOUR + 1);
    expect(await consumeLinkToken(w.deps.db, "group", token, w.clock.now)).toBeNull();
  });

  it("friend tokens are shared by the whole group (multi-use) and carry the receipt", async () => {
    const w = setup();
    const token = await createLinkToken(w.deps.db, w.hostId, "friend", { receiptId: w.receiptId, now: w.clock.now });
    const a = await consumeLinkToken(w.deps.db, "friend", token, w.clock.now);
    const b = await consumeLinkToken(w.deps.db, "friend", token, w.clock.now);
    expect(a?.receiptId).toBe(w.receiptId);
    expect(b?.receiptId).toBe(w.receiptId);
  });

  it("rejects malformed start payloads", () => {
    expect(parseStartPayload(undefined)).toBeNull();
    expect(parseStartPayload("hello")).toBeNull();
    expect(parseStartPayload("host_short")).toBeNull();
    expect(parseStartPayload("fr_" + "a".repeat(43))).toEqual({ kind: "friend", token: "a".repeat(43) });
  });
});
