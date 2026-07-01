import { Router, type IRouter } from "express";
import tripsRouter from "./trips";
import documentsRouter from "./documents";
import aiRouter from "./ai";
import wishlistRouter from "./wishlist";
import importRouter from "./import";

const router: IRouter = Router();

router.use(tripsRouter);
router.use(documentsRouter);
router.use(aiRouter);
router.use(wishlistRouter);
router.use(importRouter);

export default router;
