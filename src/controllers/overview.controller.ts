import type { Request, Response } from "express";
import { z } from "zod";
import { getShopOverview } from "../services/overview.service";
import { BizError, ErrorCode, success } from "../utils/response";

const querySchema = z.object({
  date: z.iso.date("date 格式应为 YYYY-MM-DD"),
});

export async function getOverview(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new BizError(ErrorCode.PARAM_ERROR, parsed.error.issues[0].message);
  }

  // shopId 来自 token，前端在 query 里传了也不用
  const { shopId } = req.user!;
  const data = await getShopOverview(shopId, parsed.data.date);
  res.json(success(data));
}
