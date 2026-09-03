import { Router, type IRouter } from "express";
import ornamentsRouter from "./ornaments";
import categoriesRouter from "./categories";
import statsRouter from "./stats";
import hallmarkEventsRouter from "./hallmark-events";

const router: IRouter = Router();

router.use(ornamentsRouter);
router.use(categoriesRouter);
router.use(statsRouter);
router.use(hallmarkEventsRouter);

export default router;
