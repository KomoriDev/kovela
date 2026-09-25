import nacl from "tweetnacl";
import { asciiBytes, encodeBase64, hexBytes, validPayload } from "./codec.js";

// Server-only entrypoint: never import this from the browser or wearable.
export function signLicense(payload, seedHex) {
  if (!validPayload(payload)) throw new Error("Invalid license payload");
  const body =
    "KV1." +
    encodeBase64(
      asciiBytes(
        JSON.stringify({
          v: 1,
          licenseId: payload.licenseId,
          productId: payload.productId,
          deviceId: payload.deviceId,
          issuedAt: payload.issuedAt,
        }),
      ),
    );
  const seed = hexBytes(seedHex, 32);
  const pair = nacl.sign.keyPair.fromSeed(seed);
  try {
    return (
      body +
      "." +
      encodeBase64(nacl.sign.detached(asciiBytes(body), pair.secretKey))
    );
  } finally {
    seed.fill(0);
    pair.secretKey.fill(0);
  }
}
