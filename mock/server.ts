// 模拟下游的 Java 服务：订单、商品、广告、认证，一个进程监听四个端口
import express from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok<T>(data: T) {
  return { code: 200, message: "success", data };
}

function createService(name: string, port: number, setup: (app: express.Express) => void) {
  const app = express();

  // 故障注入：delay 是额外延迟的毫秒数，failRate 是返回 500 的概率（0～1）
  // 例：curl -X POST "http://127.0.0.1:4001/__chaos?delay=3000&failRate=0"
  const chaos = { delay: 0, failRate: 0 };

  app.post("/__chaos", (req, res) => {
    chaos.delay = Number(req.query.delay) || 0;
    chaos.failRate = Number(req.query.failRate) || 0;
    console.log(`[${name}] 故障注入：`, chaos);
    res.json(chaos);
  });

  app.use(async (req, res, next) => {
    // 模拟正常的接口耗时
    await sleep(random(30, 120) + chaos.delay);
    const hasToken = req.get("authorization") ? "有" : "无";
    console.log(`[${name}] traceId=${req.get("x-trace-id")} token=${hasToken} ${req.method} ${req.url}`);

    if (Math.random() < chaos.failRate) {
      res.status(500).json({ code: 500, message: "Internal Server Error", data: null });
      return;
    }
    next();
  });

  setup(app);
  app.listen(port, () => console.log(`${name} mock 已启动：http://127.0.0.1:${port}`));
}

createService("订单服务", 4001, (app) => {
  app.get("/api/order/stats", (_req, res) => {
    const orderCount = random(200, 800);
    res.json(
      ok({
        visitorCount: orderCount * random(8, 15),
        orderCount,
        gmv: orderCount * random(5000, 20000),
        refundCount: random(0, 30),
      }),
    );
  });
});

const productNames = ["纯棉短袖T恤", "冰丝防晒衣", "高腰阔腿裤", "运动速干袜", "真丝睡衣套装", "羊毛针织开衫"];

createService("商品服务", 4002, (app) => {
  app.get("/api/product/top", (req, res) => {
    const limit = Number(req.query.limit) || 5;
    const list = productNames.slice(0, limit).map((productName, index) => {
      const salesCount = random(50, 300) - index * 20;
      return {
        productId: 10001 + index,
        productName,
        salesCount,
        salesAmount: salesCount * random(3000, 15000),
      };
    });
    res.json(ok(list));
  });
});

createService("广告服务", 4003, (app) => {
  app.get("/api/ad/stats", (_req, res) => {
    const impressions = random(50000, 200000);
    const cost = random(100000, 500000);
    res.json(
      ok({
        cost,
        impressions,
        clicks: Math.floor(impressions * random(1, 5) / 100),
        adGmv: cost * random(2, 6),
      }),
    );
  });
});

const users: Record<string, { password: string; userId: string; shopId: string }> = {
  merchant_a: { password: "123456", userId: "u_1", shopId: "1001" },
  merchant_b: { password: "123456", userId: "u_2", shopId: "1002" },
};

async function startAuthService() {
  // 私钥只在认证服务里，用来签发 token；公钥通过 JWKS 地址公开，BFF 拿它验签
  // 每次启动都重新生成密钥，相当于做了一次密钥轮换，旧 token 会全部失效
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const kid = `key-${Date.now()}`;
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

  createService("认证服务", 4004, (app) => {
    app.get("/.well-known/jwks.json", (_req, res) => {
      res.json({ keys: [publicJwk] });
    });

    app.post("/api/auth/login", express.json(), async (req, res) => {
      const user = users[req.body?.username];
      if (!user || user.password !== req.body?.password) {
        res.json({ code: 401, message: "用户名或密码错误", data: null });
        return;
      }

      // 测试过期用，例：POST /api/auth/login?expiresIn=5s
      const expiresIn = String(req.query.expiresIn || "2h");
      const token = await new SignJWT({ shopId: user.shopId })
        .setProtectedHeader({ alg: "RS256", kid })
        .setSubject(user.userId)
        .setIssuer("buz-auth")
        .setAudience("buz-bff")
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(privateKey);

      res.json(ok({ token }));
    });
  });
}

startAuthService();
