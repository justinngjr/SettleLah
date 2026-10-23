import { describe, expect, it } from "vitest";

import { DbError } from "./errors";
import { archiveFriend, createFriend, getFriend, listFriends, toFriend, updateFriend } from "./friends";
import type { FriendRow } from "./friends";
import { argsOf, chainOf, createMockDb } from "./mock-client.test-helpers";

const ROW: FriendRow = {
  id: "f1",
  host_id: "h1",
  display_name: "Bob",
  telegram_user_id: 12345,
  telegram_username: "bobby",
  private_chat_started: false,
  known_bank_names: ["BOB TAN"],
  archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

describe("friends repository", () => {
  it("maps rows to camelCase Friend objects", () => {
    expect(toFriend(ROW)).toEqual({
      id: "f1",
      hostId: "h1",
      displayName: "Bob",
      telegramUserId: 12345,
      telegramUsername: "bobby",
      privateChatStarted: false,
      knownBankNames: ["BOB TAN"],
      archived: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
  });

  it("listFriends scopes by host and hides archived friends by default", async () => {
    const { db, calls } = createMockDb([{ data: [ROW] }]);
    const friends = await listFriends(db, "h1");
    expect(friends.map((f) => f.displayName)).toEqual(["Bob"]);
    expect(calls[0].table).toBe("friends");
    expect(argsOf(calls[0], "eq")).toEqual([
      ["host_id", "h1"],
      ["archived", false],
    ]);
  });

  it("listFriends can include archived friends", async () => {
    const { db, calls } = createMockDb([{ data: [] }]);
    await listFriends(db, "h1", { includeArchived: true });
    expect(argsOf(calls[0], "eq")).toEqual([["host_id", "h1"]]);
  });

  it("getFriend returns null when there is no such friend for this host", async () => {
    const { db, calls } = createMockDb([{ data: null }]);
    expect(await getFriend(db, "h1", "nope")).toBeNull();
    expect(chainOf(calls[0])).toContain("maybeSingle");
  });

  it("createFriend inserts a host-owned row with defaults", async () => {
    const { db, calls } = createMockDb([{ data: ROW }]);
    const friend = await createFriend(db, "h1", { displayName: "Bob" });
    expect(friend.id).toBe("f1");
    expect(argsOf(calls[0], "insert")[0][0]).toEqual({
      host_id: "h1",
      display_name: "Bob",
      telegram_user_id: null,
      telegram_username: null,
      known_bank_names: [],
    });
  });

  it("updateFriend only sends the fields in the patch", async () => {
    const { db, calls } = createMockDb([{ data: { ...ROW, display_name: "Robert" } }]);
    const friend = await updateFriend(db, "h1", "f1", { displayName: "Robert", privateChatStarted: true });
    expect(friend.displayName).toBe("Robert");
    expect(argsOf(calls[0], "update")[0][0]).toEqual({ display_name: "Robert", private_chat_started: true });
    expect(argsOf(calls[0], "eq")).toEqual([
      ["host_id", "h1"],
      ["id", "f1"],
    ]);
  });

  it("archiveFriend flips the flag instead of deleting", async () => {
    const { db, calls } = createMockDb([{ data: { ...ROW, archived: true } }]);
    const friend = await archiveFriend(db, "h1", "f1");
    expect(friend.archived).toBe(true);
    expect(chainOf(calls[0])).not.toContain("delete");
    expect(argsOf(calls[0], "update")[0][0]).toEqual({ archived: true });
  });

  it("wraps PostgREST errors in DbError with the SQLSTATE", async () => {
    const { db } = createMockDb([{ error: { message: "boom", code: "42501" } }]);
    await expect(listFriends(db, "h1")).rejects.toMatchObject({ name: "DbError", code: "42501" });
    await expect(getFriend(createMockDb([{ error: { message: "x" } }]).db, "h1", "f1")).rejects.toBeInstanceOf(DbError);
  });
});
