import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import potteryRouter from "./pottery";
import quiltingRouter from "./quilting";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use("/pottery", potteryRouter);
router.use("/quilting", quiltingRouter);

export default router;
