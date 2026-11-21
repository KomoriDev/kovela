-- 型号（付费档位）：同一应用按爱发电 SKU 分档出售（如斗地主的普通版 / 联机版）。
-- edition 是写进许可证的型号编号，没有配置型号的商品保持 NULL，签发的令牌不变。
-- upgrade=1 表示这份授权只经由补差价的升级 SKU 获得：首次绑定要求同一台设备
-- 已持有更低型号的已付款授权。
ALTER TABLE entitlements ADD COLUMN edition TEXT;
ALTER TABLE entitlements ADD COLUMN upgrade INTEGER NOT NULL DEFAULT 0;

-- 升级与防降级检查按「商品 + 设备」查已绑定授权。
CREATE INDEX entitlements_device_product ON entitlements(device_id, product_id);
