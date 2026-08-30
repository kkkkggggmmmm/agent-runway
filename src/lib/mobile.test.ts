import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeMobileAccessToken,
  cloudMobileHeaders,
  getMobileAccessToken,
  mobileAuthorizationHeaders,
  MOBILE_TOKEN_STORAGE_KEY,
} from "./mobile";

describe("mobile pairing token", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("consumes the fragment token and removes it from the visible URL", () => {
    const token = "a".repeat(64);
    window.history.replaceState(null, "", `/#access_token=${token}`);

    expect(consumeMobileAccessToken()).toBe(token);
    expect(window.location.hash).toBe("");
    expect(localStorage.getItem(MOBILE_TOKEN_STORAGE_KEY)).toBe(token);
  });

  it("ignores malformed tokens", () => {
    window.history.replaceState(null, "", "/#access_token=too-short");
    expect(consumeMobileAccessToken()).toBeNull();
    expect(getMobileAccessToken()).toBeNull();
  });

  it("uses the stored secret only as a bearer header", () => {
    const token = "B".repeat(64);
    localStorage.setItem(MOBILE_TOKEN_STORAGE_KEY, token);
    expect(mobileAuthorizationHeaders()).toEqual({ Authorization: `Bearer ${token}` });
  });

  it("adds only public Supabase metadata alongside the bearer token", () => {
    const token = "C".repeat(64);
    localStorage.setItem(MOBILE_TOKEN_STORAGE_KEY, token);
    expect(cloudMobileHeaders()).toEqual(expect.objectContaining({
      Accept: "application/json",
      apikey: expect.stringMatching(/^sb_publishable_/),
      Authorization: `Bearer ${token}`,
    }));
  });
});
