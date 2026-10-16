-- 会话在创建时就核过一次爱发电订单（/api/orders/lookup）。记下那次核对的
-- 时刻，签发（/api/activate）在会话还很新时直接复用结论，不再重复外呼：
-- 每次激活都多等一次爱发电往返既拖慢「签发许可证」，也让爱发电抖动直接
-- 变成激活失败。放久了的会话该列为旧值（或为空），照旧复核付款状态。
ALTER TABLE sessions ADD COLUMN verified_at INTEGER;
