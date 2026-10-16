CREATE INDEX purchases_buyer_paid ON purchases(lower(buyer_id), payment_status, updated_at DESC);
