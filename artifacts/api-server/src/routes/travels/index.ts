import { Router, type IRouter } from "express";
import tripsRouter from "./trips";
import documentsRouter from "./documents";
import aiRouter from "./ai";
import wishlistRouter from "./wishlist";
import importRouter from "./import";
import photosRouter from "./photos";
import remindersRouter from "./reminders";
import destinationsRouter from "./destinations";
import settingsRouter from "./settings";
import magnetsRouter from "./magnets";

const router: IRouter = Router();

router.use(tripsRouter);
router.use(documentsRouter);
router.use(aiRouter);
router.use(wishlistRouter);
router.use(importRouter);
router.use(photosRouter);
router.use(remindersRouter);
router.use(destinationsRouter);
router.use(settingsRouter);
router.use(magnetsRouter);

export default router;
