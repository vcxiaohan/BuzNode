import { Router } from "express";
import { getOverview } from "../controllers/overview.controller";
import { auth } from "../middlewares/auth";
import { ipLimiter, userLimiter } from "../middlewares/rate-limit";

const router = Router();

// 顺序不能乱：先按 IP 限流，再鉴权，再按用户限流
router.use(ipLimiter);
router.use(auth);
router.use(userLimiter);

router.get("/bi/overview", getOverview);

export default router;
