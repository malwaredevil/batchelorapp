import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import potteryRouter from "./pottery";
import quiltingRouter from "./quilting";
import ornamentsRouter from "./ornaments";
import officeRouter from "./office";
import travelsRouter from "./travels";
import hubRouter from "./hub";
import devScreenshotLoginRouter from "./dev-screenshot-login";
import elaineRouter from "../elaine";
import gmailRouter from "./gmail";
import searchRouter from "./search";
import agentphoneRouter from "./agentphone";
import elaineEmailRouter from "./elaine-email";
import configRouter from "./config";
import messengerRouter from "./messenger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(devScreenshotLoginRouter);
router.use(searchRouter);
router.use("/pottery", potteryRouter);
router.use("/quilting", quiltingRouter);
router.use("/ornaments", ornamentsRouter);
router.use("/office", officeRouter);
router.use("/travels", travelsRouter);
router.use("/gmail", gmailRouter);
router.use("/config", configRouter);
router.use("/messenger", messengerRouter);
// Must be mounted before elaineRouter: elaineRouter applies a blanket
// requireAuth middleware to every /elaine/* path, which would otherwise
// swallow this unauthenticated (signature-gated) webhook route before it's
// ever reached.
router.use("/elaine", elaineEmailRouter);
router.use("/elaine", elaineRouter);
router.use("/agentphone", agentphoneRouter);
router.use(hubRouter);

export default router;
