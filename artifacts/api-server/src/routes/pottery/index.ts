import { Router, type IRouter } from "express";
import potteryRouter from "./pottery";
import categoriesRouter from "./categories";
import compareRouter from "./compare";
import statsRouter from "./stats";
import watchlistRouter from "./watchlist";

const router: IRouter = Router();

router.use(potteryRouter);
router.use(categoriesRouter);
router.use(compareRouter);
router.use(statsRouter);
router.use(watchlistRouter);

export default router;
