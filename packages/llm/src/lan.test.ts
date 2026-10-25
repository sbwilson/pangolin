import { describe, expect, it } from "vitest";
import { isLanAddress } from "./lan.ts";

describe("isLanAddress", () => {
  describe("RFC 1918 private subnets", () => {
    it("classifies 10.0.0.0/8 as local", () => {
      expect(isLanAddress("10.0.0.1")).toBe(true);
      expect(isLanAddress("http://10.1.2.3:11434/v1")).toBe(true);
      expect(isLanAddress("10.255.255.255")).toBe(true);
    });

    it("classifies 172.16.0.0/12 as local and out-of-range as non-local", () => {
      expect(isLanAddress("172.16.0.1")).toBe(true);
      expect(isLanAddress("http://172.20.0.5:8000/v1")).toBe(true);
      expect(isLanAddress("172.31.255.254")).toBe(true);

      // Boundaries outside 172.16-31
      expect(isLanAddress("172.15.255.255")).toBe(false);
      expect(isLanAddress("172.32.0.1")).toBe(false);
    });

    it("classifies 192.168.0.0/16 as local", () => {
      expect(isLanAddress("192.168.1.1")).toBe(true);
      expect(isLanAddress("http://192.168.1.50:11434/v1")).toBe(true);
      expect(isLanAddress("192.168.255.255")).toBe(true);

      expect(isLanAddress("192.169.1.1")).toBe(false);
      expect(isLanAddress("192.167.1.1")).toBe(false);
    });
  });

  describe("Loopback and link-local addresses", () => {
    it("classifies IPv4 loopback 127.0.0.0/8 as local", () => {
      expect(isLanAddress("127.0.0.1")).toBe(true);
      expect(isLanAddress("http://127.0.0.1:11434/v1")).toBe(true);
      expect(isLanAddress("127.1.2.3")).toBe(true);
    });

    it("classifies localhost as local", () => {
      expect(isLanAddress("localhost")).toBe(true);
      expect(isLanAddress("http://localhost:11434")).toBe(true);
      expect(isLanAddress("my-app.localhost")).toBe(true);
    });

    it("classifies IPv6 loopback ::1 as local", () => {
      expect(isLanAddress("::1")).toBe(true);
      expect(isLanAddress("http://[::1]:11434/v1")).toBe(true);
    });

    it("classifies link-local ranges as local", () => {
      // IPv4 link-local (169.254.0.0/16)
      expect(isLanAddress("169.254.1.1")).toBe(true);
      expect(isLanAddress("http://169.254.169.254/latest/meta-data")).toBe(true);

      // IPv6 link-local (fe80::/10)
      expect(isLanAddress("fe80::1ff:fe23:4567:890a")).toBe(true);
      expect(isLanAddress("http://[fe80::1]:8080")).toBe(true);
    });

    it("classifies IPv6 unique local addresses (ULA) as local", () => {
      expect(isLanAddress("fc00::1")).toBe(true);
      expect(isLanAddress("fd12:3456:789a::1")).toBe(true);
    });

    it("classifies IPv4-mapped IPv6 addresses based on the IPv4 segment", () => {
      expect(isLanAddress("::ffff:192.168.1.1")).toBe(true);
      expect(isLanAddress("http://[::ffff:10.0.0.1]:11434")).toBe(true);
      expect(isLanAddress("::ffff:127.0.0.1")).toBe(true);
      expect(isLanAddress("::ffff:8.8.8.8")).toBe(false);
      expect(isLanAddress("http://[::ffff:1.1.1.1]:80")).toBe(false);
    });
  });

  describe("mDNS addresses", () => {
    it("classifies *.local hostnames as local", () => {
      expect(isLanAddress("my-mac.local")).toBe(true);
      expect(isLanAddress("http://ollama-box.local:11434/v1")).toBe(true);
    });
  });

  describe("Public internet addresses and cloud hosts", () => {
    it("classifies cloud endpoints and public IPs as non-local", () => {
      expect(isLanAddress("https://api.openai.com/v1")).toBe(false);
      expect(isLanAddress("https://api.anthropic.com/v1")).toBe(false);
      expect(isLanAddress("api.openai.com")).toBe(false);
      expect(isLanAddress("8.8.8.8")).toBe(false);
      expect(isLanAddress("1.1.1.1")).toBe(false);
      expect(isLanAddress("2607:f8b0:4005:805::200e")).toBe(false);
      expect(isLanAddress("example.com")).toBe(false);
    });

    it("handles empty or invalid inputs cleanly", () => {
      expect(isLanAddress("")).toBe(false);
      expect(isLanAddress("   ")).toBe(false);
      expect(isLanAddress("999.999.999.999")).toBe(false);
    });
  });
});
