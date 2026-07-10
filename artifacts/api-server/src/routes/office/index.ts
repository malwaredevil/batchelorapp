import { Router, type IRouter } from "express";
import notesRouter from "./notes";

const router: IRouter = Router();

router.use(notesRouter);

export default router;
