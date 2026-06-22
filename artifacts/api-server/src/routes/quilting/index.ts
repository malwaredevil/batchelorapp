import { Router, type IRouter } from "express";
import fabricsRouter from "./fabrics";
import patternsRouter from "./patterns";
import quiltsRouter from "./quilts";
import categoriesRouter from "./categories";
import compareRouter from "./compare";
import statsRouter from "./stats";
import blocksRouter from "./blocks";
import layoutsRouter from "./layouts";
import shoppingRouter from "./shopping";
import patternImportRouter from "./pattern-import";

const router: IRouter = Router();

router.use(fabricsRouter);
router.use(patternsRouter);
router.use(quiltsRouter);
router.use(categoriesRouter);
router.use(compareRouter);
router.use(statsRouter);
router.use(blocksRouter);
router.use(layoutsRouter);
router.use(shoppingRouter);
router.use(patternImportRouter);

export default router;
