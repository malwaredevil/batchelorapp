import { Router, type IRouter } from "express";
import { requireAuth } from "../../middleware/auth";
import conversationsRouter from "./conversations";
import messagesRouter from "./messages";
import attachmentsRouter from "./attachments";
import linkPreviewRouter from "./link-preview";
import pushRouter from "./push";
import typingRouter from "./typing";

const router: IRouter = Router();

router.use(requireAuth);
router.use(conversationsRouter);
router.use(messagesRouter);
router.use(attachmentsRouter);
router.use(linkPreviewRouter);
router.use(pushRouter);
router.use(typingRouter);

export default router;
