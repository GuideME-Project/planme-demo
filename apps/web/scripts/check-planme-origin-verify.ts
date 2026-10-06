import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { defaultLocale } from "../lib/i18n/routing";
import { createClientAddressHash, getTrustedClientAddress } from "../lib/planme-client-ip";
import {
  PLANME_ORIGIN_VERIFY_HEADER,
  isPlanmeOriginVerified,
  shouldRejectUnverifiedOrigin,
} from "../lib/planme-origin-verify";

const SECRET = "test-origin-secret-not-a-real-value";
const ENV_SECRET = "PLANME_ORIGIN_VERIFY_SECRET";
const ENV_ENFORCE = "PLANME_ORIGIN_VERIFY_ENFORCE";

function main() {
  assertVerificationStates();
  assertClientAddressTrustsCloudflareOnlyWhenVerified();
  assertProxyEnforcement();
  console.log("PlanME origin verification contract passed");
}

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function headers(values: Record<string, string>) {
  return new Headers(values);
}

function assertVerificationStates() {
  // 비밀이 설정되지 않으면 아무 요청도 검증된 것으로 취급하지 않고, 차단도 하지 않습니다(설정 오류만 기록).
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    withEnv({ [ENV_SECRET]: undefined, [ENV_ENFORCE]: "true" }, () => {
      assert.equal(isPlanmeOriginVerified(headers({ [PLANME_ORIGIN_VERIFY_HEADER]: SECRET })), false);
      assert.equal(shouldRejectUnverifiedOrigin(headers({})), false);
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(errors, [["PLANME_ORIGIN_VERIFY_ENFORCE_WITHOUT_SECRET"]]);

  // 비밀은 있지만 강제 모드가 꺼져 있으면 검증만 하고 차단하지 않습니다.
  withEnv({ [ENV_SECRET]: SECRET, [ENV_ENFORCE]: undefined }, () => {
    assert.equal(isPlanmeOriginVerified(headers({ [PLANME_ORIGIN_VERIFY_HEADER]: SECRET })), true);
    assert.equal(isPlanmeOriginVerified(headers({ [PLANME_ORIGIN_VERIFY_HEADER]: "wrong" })), false);
    assert.equal(isPlanmeOriginVerified(headers({})), false);
    assert.equal(shouldRejectUnverifiedOrigin(headers({})), false);
  });

  // 강제 모드에서는 올바른 헤더가 없는 요청만 차단합니다.
  withEnv({ [ENV_SECRET]: SECRET, [ENV_ENFORCE]: "true" }, () => {
    assert.equal(shouldRejectUnverifiedOrigin(headers({})), true);
    assert.equal(shouldRejectUnverifiedOrigin(headers({ [PLANME_ORIGIN_VERIFY_HEADER]: "wrong" })), true);
    assert.equal(shouldRejectUnverifiedOrigin(headers({ [PLANME_ORIGIN_VERIFY_HEADER]: SECRET })), false);
  });

  // "true" 이외의 값은 강제 모드로 취급하지 않습니다.
  withEnv({ [ENV_SECRET]: SECRET, [ENV_ENFORCE]: "false" }, () => {
    assert.equal(shouldRejectUnverifiedOrigin(headers({})), false);
  });
}

function assertClientAddressTrustsCloudflareOnlyWhenVerified() {
  const forwarded = "198.51.100.9, 203.0.113.7";

  // 검증되지 않은 요청이 보낸 CF-Connecting-IP는 위조될 수 있으므로 무시하고 ALB가 붙인 마지막 항목을 씁니다.
  withEnv({ [ENV_SECRET]: SECRET, [ENV_ENFORCE]: undefined }, () => {
    const forged = new Request("https://www.planme.kr/api/magazine", {
      headers: { "x-forwarded-for": forwarded, "cf-connecting-ip": "192.0.2.1" },
    });
    assert.equal(getTrustedClientAddress(forged), "203.0.113.7");

    const wrongSecret = new Request("https://www.planme.kr/api/magazine", {
      headers: {
        "x-forwarded-for": forwarded,
        "cf-connecting-ip": "192.0.2.1",
        [PLANME_ORIGIN_VERIFY_HEADER]: "wrong",
      },
    });
    assert.equal(getTrustedClientAddress(wrongSecret), "203.0.113.7");

    const verified = new Request("https://www.planme.kr/api/magazine", {
      headers: {
        "x-forwarded-for": forwarded,
        "cf-connecting-ip": "192.0.2.1",
        [PLANME_ORIGIN_VERIFY_HEADER]: SECRET,
      },
    });
    assert.equal(getTrustedClientAddress(verified), "192.0.2.1");

    const verifiedIpv6 = new Request("https://www.planme.kr/api/magazine", {
      headers: { "cf-connecting-ip": "2001:db8::1", [PLANME_ORIGIN_VERIFY_HEADER]: SECRET },
    });
    assert.equal(getTrustedClientAddress(verifiedIpv6), "2001:db8::1");

    // 검증됐더라도 IP 형식이 아니면 기존 방식으로 되돌립니다.
    const verifiedMalformed = new Request("https://www.planme.kr/api/magazine", {
      headers: {
        "x-forwarded-for": forwarded,
        "cf-connecting-ip": "not-an-ip",
        [PLANME_ORIGIN_VERIFY_HEADER]: SECRET,
      },
    });
    assert.equal(getTrustedClientAddress(verifiedMalformed), "203.0.113.7");

    // 같은 사용자는 어느 경로로 오든 같은 해시를 받아야 호출 제한이 일관됩니다.
    const viaAlbOnly = new Request("https://www.planme.kr/api/magazine", {
      headers: { "x-forwarded-for": "192.0.2.1" },
    });
    assert.equal(createClientAddressHash(verified), createClientAddressHash(viaAlbOnly));
  });

  // 비밀이 설정되지 않으면 Cloudflare 헤더를 전혀 신뢰하지 않습니다.
  withEnv({ [ENV_SECRET]: undefined, [ENV_ENFORCE]: undefined }, () => {
    const request = new Request("https://www.planme.kr/api/magazine", {
      headers: {
        "x-forwarded-for": forwarded,
        "cf-connecting-ip": "192.0.2.1",
        [PLANME_ORIGIN_VERIFY_HEADER]: SECRET,
      },
    });
    assert.equal(getTrustedClientAddress(request), "203.0.113.7");
  });
}

function assertProxyEnforcement() {
  const url = (path: string) => `https://www.planme.kr${path}`;

  withEnv({ [ENV_SECRET]: SECRET, [ENV_ENFORCE]: "true" }, () => {
    // 헤더가 없는 직접 요청은 403입니다. 로케일 리다이렉트보다 먼저 막아야 합니다.
    for (const path of ["/", "/ko", "/en/itinerary/abc", "/itinerary/abc", "/api/magazine", "/og"]) {
      const response = proxy(new NextRequest(url(path)));
      assert.equal(response?.status, 403, `${path} without the origin header must be rejected`);
    }

    // ALB 헬스체크는 헤더 없이 통과해야 합니다.
    const health = proxy(new NextRequest(url("/api/health")));
    assert.equal(health?.status, 200);

    // 올바른 헤더가 있으면 기존 로케일 동작이 그대로입니다.
    const verifiedHeaders = { [PLANME_ORIGIN_VERIFY_HEADER]: SECRET };
    const root = proxy(new NextRequest(url("/"), { headers: verifiedHeaders }));
    assert.equal(root?.status, 307);
    assert.equal(new URL(root?.headers.get("location") ?? "").pathname, `/${defaultLocale}`);

    const english = proxy(new NextRequest(url("/en/itinerary/abc"), { headers: verifiedHeaders }));
    assert.equal(english?.status, 200);

    const api = proxy(new NextRequest(url("/api/magazine"), { headers: verifiedHeaders }));
    assert.equal(api?.status, 200);
    assert.equal(api?.headers.get("x-middleware-request-x-planme-locale"), null);
  });

  // 강제 모드가 꺼져 있으면 기존 동작과 같습니다.
  withEnv({ [ENV_SECRET]: SECRET, [ENV_ENFORCE]: undefined }, () => {
    assert.equal(proxy(new NextRequest(url("/api/magazine")))?.status, 200);
    assert.equal(proxy(new NextRequest(url("/")))?.status, 307);
  });
}

main();
