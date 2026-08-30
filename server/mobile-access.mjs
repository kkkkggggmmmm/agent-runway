import { timingSafeEqual } from "node:crypto";

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

const safeEqual = (left, right) => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const bearerToken = (request) => {
  const authorization = request.headers.authorization || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

export const createMobileAccessPolicy = ({ port, publicOrigin, mobileToken }) => {
  let remoteOrigin = null;
  if (publicOrigin) {
    try {
      const parsed = new URL(publicOrigin);
      if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw new Error("AGENT_RUNWAY_PUBLIC_ORIGIN must be an HTTPS origin without a path");
      }
      remoteOrigin = parsed.origin;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "AGENT_RUNWAY_PUBLIC_ORIGIN is invalid");
    }
    if (!mobileToken || mobileToken.length < 40) {
      throw new Error("AGENT_RUNWAY_MOBILE_TOKEN must contain at least 40 characters when public access is enabled");
    }
  }

  const allowedRequest = (request) => {
    const host = request.headers.host || "";
    const origin = request.headers.origin;
    if (LOCAL_HOST.test(host)) {
      return !origin || new RegExp(`^http://(127\\.0\\.0\\.1|localhost):(${port}|5173)$`).test(origin);
    }
    if (!remoteOrigin || host !== new URL(remoteOrigin).host) return false;
    return !origin || origin === remoteOrigin;
  };

  const authorizedApiRequest = (request) => {
    const host = request.headers.host || "";
    if (LOCAL_HOST.test(host)) return true;
    const supplied = bearerToken(request);
    return Boolean(remoteOrigin && mobileToken && supplied && safeEqual(supplied, mobileToken));
  };

  return { allowedRequest, authorizedApiRequest, remoteOrigin };
};
