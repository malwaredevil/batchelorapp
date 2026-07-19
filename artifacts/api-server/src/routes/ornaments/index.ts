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
import hoohCrawlRouter from "./hooh-crawl";
import apifyWebhookRouter from "./apify-webhook";

const router: IRouter = Router();

// Apify webhook — unauthenticated (token-gated), must be mounted before any
// router that applies requireAuth so the signature check isn't pre-empted.
router.use(apifyWebhookRouter);

router.use(ornamentsRouter);
router.use(categoriesRouter);
router.use(statsRouter);
router.use(hallmarkEventsRouter);
router.use(identityResearchRouter);
router.use(canonicalSeriesRouter);
router.use(hallmarkSearchRouter);
router.use(catalogCrawlRouter);
router.use(historicalCrawlRouter);
router.use(hoohCrawlRouter);

export default router;
