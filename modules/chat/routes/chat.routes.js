import express from "express";
import auth from "../../../middleware/auth.middleware.js";
import {
  clearConversation,
  getAdminUsersForChat,
  getConversationForAdmin,
  getMyConversation,
} from "../controller/chat.controller.js";

const router = express.Router();

router.get("/users", auth, getAdminUsersForChat);
router.get("/messages", auth, getMyConversation);
router.get("/messages/:userId", auth, getConversationForAdmin);
router.delete("/messages", auth, clearConversation);

export default router;
