import test from "node:test";
import assert from "node:assert/strict";
import * as chatController from "./chat.controller.js";

test("sendMessage should be exported for HTTP-based user chat sends", () => {
  assert.equal(typeof chatController.sendMessage, "function");
});
