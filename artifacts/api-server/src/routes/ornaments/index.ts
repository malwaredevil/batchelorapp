import { Router, type IRouter } from "express";
import ornamentsRouter from "./ornaments";
import categoriesRouter from "./categories";
import statsRouter from "./stats";
import hallmarkEventsRouter from "./hallmark-events";
import identityResearchRouter from "./identity-research";
import canonicalSeriesRouter from "./canonical-series";
import hallmarkSearchRouter from "./hallmark-search";
import catalogCrawlRouter from "./catalog-crawl";
import historicalCrawlRouter from "./historical-crawl";

const router: IRouter = Router();

router.use(ornamentsRouter);
router.use(categoriesRouter);
router.use(statsRouter);
router.use(hallmarkEventsRouter);
router.use(identityResearchRouter);
router.use(canonicalSeriesRouter);
router.use(hallmarkSearchRouter);
router.use(catalogCrawlRouter);
router.use(historicalCrawlRouter);

export default router;
