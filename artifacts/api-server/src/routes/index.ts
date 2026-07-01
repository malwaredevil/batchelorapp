import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import potteryRouter from "./pottery";
import quiltingRouter from "./quilting";
import travelsRouter from "./travels";
import hubRouter from "./hub";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use("/pottery", potteryRouter);
router.use("/quilting", quiltingRouter);
router.use("/travels", travelsRouter);
router.use(hubRouter);

export default router;
