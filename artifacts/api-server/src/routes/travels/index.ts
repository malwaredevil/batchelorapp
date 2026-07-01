import { Router, type IRouter } from "express";
import tripsRouter from "./trips";
import documentsRouter from "./documents";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(tripsRouter);
router.use(documentsRouter);
router.use(aiRouter);

export default router;
