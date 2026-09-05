import { describe, expect, it } from "vitest";
import { isCloudBrokerHost } from "./cloud-broker";

describe("Cloud Broker runtime detection", () => {
  it("recognizes a Fly Cloud Broker origin even if a stale runtime script is present", () => {
    expect(isCloudBrokerHost("agent-runway-example.fly.dev")).toBe(true);
    expect(isCloudBrokerHost("agent-runway-mobile.example.com")).toBe(false);
    expect(isCloudBrokerHost("fly.dev")).toBe(false);
  });
});
