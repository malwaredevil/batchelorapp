import { Router, type IRouter } from "express";
import ornamentsRouter from "./ornaments";
import categoriesRouter from "./categories";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(ornamentsRouter);
router.use(categoriesRouter);
router.use(statsRouter);

export default router;
