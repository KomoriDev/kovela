use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use serde_json::{Value, json};

pub(crate) const PRODUCTS: &[(&str, &str)] = &[
    ("com.komoridev.billiard", "口袋台球"),
    ("com.komoridev.tankturmoil", "坦克动荡"),
];

pub(crate) fn product_name(product_id: &str) -> Option<&'static str> {
    PRODUCTS.iter().find(|(id, _)| *id == product_id).map(|(_, name)| *name)
}

#[derive(Clone, Debug)]
pub(crate) struct License {
    pub(crate) license_id: String,
    pub(crate) license_token: String,
    pub(crate) product_id: String,
    pub(crate) device_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    v: u8,
    license_id: String,
    product_id: String,
    device_id: String,
    issued_at: u64,
}

fn valid_device(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

// Decoding is only a routing check. The wearable verifies the Ed25519 signature.
pub(crate) fn parse_license(input: &str) -> Result<License, String> {
    if input.len() > 8192 {
        return Err("许可证内容过长".into());
    }
    let input = input.trim();
    let envelope = if input.starts_with('{') {
        let value: Value = serde_json::from_str(input).map_err(|_| "许可证文件格式错误")?;
        if value["v"] != 1 || value["type"] != "kovela-offline-license" {
            return Err("不是 Kovela 离线许可证".into());
        }
        Some(value)
    } else {
        None
    };
    let token = match &envelope {
        Some(value) => value["licenseToken"].as_str().ok_or("许可证文件缺少授权串")?,
        None => input,
    };
    if token.len() > 2048 {
        return Err("授权串过长".into());
    }
    let mut segments = token.split('.');
    let (Some(prefix), Some(body), Some(signature)) = (segments.next(), segments.next(), segments.next()) else {
        return Err("授权串格式错误".into());
    };
    if prefix != "KV1" || segments.next().is_some() {
        return Err("授权串格式错误".into());
    }
    let bytes = URL_SAFE_NO_PAD.decode(body).map_err(|_| "授权串编码错误")?;
    let signature = URL_SAFE_NO_PAD.decode(signature).map_err(|_| "签名编码错误")?;
    if signature.len() != 64 || !bytes.is_ascii() {
        return Err("授权串格式错误".into());
    }
    let payload: Payload = serde_json::from_slice(&bytes).map_err(|_| "授权内容格式错误")?;
    if payload.v != 1
        || !(16..=80).contains(&payload.license_id.len())
        || !payload.license_id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        || product_name(&payload.product_id).is_none()
        || !valid_device(&payload.device_id)
        || payload.issued_at == 0
        || payload.issued_at > 9_007_199_254_740_991
    {
        return Err("授权内容不受支持".into());
    }
    if let Some(value) = &envelope {
        for (name, expected) in [
            ("licenseId", payload.license_id.as_str()),
            ("productId", payload.product_id.as_str()),
            ("deviceId", payload.device_id.as_str()),
        ] {
            if value.get(name).is_some_and(|outer| outer.as_str() != Some(expected)) {
                return Err("许可证文件与授权串不匹配".into());
            }
        }
    }
    Ok(License {
        license_id: payload.license_id,
        license_token: token.to_string(),
        product_id: payload.product_id,
        device_id: payload.device_id,
    })
}

pub(crate) fn request(
    order_no: &str,
    product_id: &str,
    device_id: &str,
    device_model: Option<&str>,
) -> Result<String, String> {
    if !(16..=32).contains(&order_no.len()) || !order_no.bytes().all(|c| c.is_ascii_digit()) {
        return Err("请输入 16～32 位爱发电订单号".into());
    }
    if product_name(product_id).is_none() || !valid_device(device_id) {
        return Err("请先获取该应用的设备码".into());
    }
    let mut value = json!({
        "v": 1,
        "type": "kovela-offline-request",
        "orderNo": order_no,
        "productId": product_id,
        "deviceId": device_id,
    });
    if let Some(model) = device_model {
        if model.chars().count() > 80 || model.chars().any(char::is_control) {
            return Err("设备型号格式错误".into());
        }
        value["deviceModel"] = model.into();
    }
    serde_json::to_string(&value).map_err(|_| "申请生成失败".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(payload: Value) -> String {
        format!("KV1.{}.{}", URL_SAFE_NO_PAD.encode(payload.to_string()), URL_SAFE_NO_PAD.encode([0_u8; 64]))
    }
    fn payload() -> Value {
        json!({"v":1,"licenseId":"offline-license-0001","productId":PRODUCTS[0].0,"deviceId":"a".repeat(64),"issuedAt":1790000000000_u64})
    }

    #[test]
    fn accepts_raw_license_and_rejects_mismatched_envelope() {
        let raw = token(payload());
        let parsed = parse_license(&raw).unwrap();
        assert_eq!(parsed.device_id, "a".repeat(64));
        let mut envelope = json!({"v":1,"type":"kovela-offline-license","licenseToken":raw,"productId":PRODUCTS[0].0,"deviceId":"a".repeat(64),"licenseId":"offline-license-0001"});
        assert_eq!(parse_license(&envelope.to_string()).unwrap().license_token, raw);
        envelope["deviceId"] = "b".repeat(64).into();
        assert!(parse_license(&envelope.to_string()).is_err());
    }

    #[test]
    fn rejects_invalid_routing_payload_and_encoding() {
        for (field, value) in [
            ("deviceId", json!("A".repeat(64))),
            ("deviceId", json!("a".repeat(63))),
            ("productId", json!("com.other.app")),
            ("licenseId", json!("short")),
            ("issuedAt", json!(0)),
            ("issuedAt", json!(9_007_199_254_740_992_u64)),
            ("v", json!(2)),
        ] {
            let mut body = payload();
            body[field] = value;
            assert!(parse_license(&token(body)).is_err());
        }
        let raw = token(payload());
        assert!(parse_license(&(raw.clone() + "=")).is_err());
        assert!(parse_license(&raw.rsplit_once('.').unwrap().0.to_string()).is_err());
        assert!(parse_license(&"x".repeat(8193)).is_err());
    }

    #[test]
    fn exports_exact_order_product_and_device_without_normalizing_identity() {
        let value: Value = serde_json::from_str(&request("0000000000000001", PRODUCTS[0].0, &"a".repeat(64), Some("Xiaomi Band 9")).unwrap()).unwrap();
        assert_eq!(value["orderNo"], "0000000000000001");
        assert_eq!(value["deviceId"], "a".repeat(64));
        assert_eq!(value["productId"], PRODUCTS[0].0);
        assert_eq!(value["deviceModel"], "Xiaomi Band 9");
        assert!(request("123", PRODUCTS[0].0, &"a".repeat(64), None).is_err());
        assert!(request("0000000000000001", PRODUCTS[0].0, "AA:BB:CC:DD:EE:FF", None).is_err());
    }
}
