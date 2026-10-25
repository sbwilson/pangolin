/**
 * LAN and local address classification (AD-6).
 *
 * Classifies addresses as local when they reside in:
 * - RFC 1918 private subnets: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Loopback ranges: 127.0.0.0/8, ::1, localhost, *.localhost
 * - Link-local ranges: 169.254.0.0/16, fe80::/10
 * - Unique local IPv6 addresses (RFC 4193): fc00::/7
 * - IPv4-mapped IPv6 addresses for local IPv4 addresses (::ffff:192.168.x.x)
 * - mDNS hostnames: *.local
 */

function extractHostname(urlOrHost: string): string {
  const trimmed = urlOrHost.trim();
  if (!trimmed) {
    return "";
  }

  // If it has a scheme, parse with standard URL
  if (trimmed.includes("://")) {
    try {
      const parsed = new URL(trimmed);
      return cleanHostname(parsed.hostname);
    } catch {
      // Fall through to manual parsing
    }
  }

  // Attempt to parse as http://<trimmed>
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (parsed.hostname) {
      return cleanHostname(parsed.hostname);
    }
  } catch {
    // Fall through to manual cleanup
  }

  // Strip scheme prefix if present before fallback slash parsing
  let stripped = trimmed;
  const schemeIdx = stripped.indexOf("://");
  if (schemeIdx !== -1) {
    stripped = stripped.slice(schemeIdx + 3);
  }

  // Strip path or query
  const slashIdx = stripped.indexOf("/");
  const withoutPath = slashIdx !== -1 ? stripped.slice(0, slashIdx) : stripped;

  // Handle IPv6 enclosed in brackets
  if (withoutPath.startsWith("[")) {
    const closeIdx = withoutPath.indexOf("]");
    if (closeIdx !== -1) {
      return cleanHostname(withoutPath.slice(1, closeIdx));
    }
  }

  // Handle host:port (for non-IPv6)
  const colonIdx = withoutPath.indexOf(":");
  if (colonIdx !== -1 && withoutPath.indexOf(":", colonIdx + 1) === -1) {
    return cleanHostname(withoutPath.slice(0, colonIdx));
  }

  return cleanHostname(withoutPath);
}

function cleanHostname(hostname: string): string {
  let cleaned = hostname.toLowerCase().trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned;
}

function isIpv4InSubnet(octets: number[]): boolean {
  const [o0, o1] = octets as [number, number, number, number];

  // 127.0.0.0/8 (Loopback)
  if (o0 === 127) return true;

  // 10.0.0.0/8 (RFC 1918)
  if (o0 === 10) return true;

  // 172.16.0.0/12 (RFC 1918: 172.16.0.0 - 172.31.255.255)
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;

  // 192.168.0.0/16 (RFC 1918)
  if (o0 === 192 && o1 === 168) return true;

  // 169.254.0.0/16 (Link-Local)
  if (o0 === 169 && o1 === 254) return true;

  // 0.0.0.0 (Unspecified / Current network)
  if (o0 === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0) return true;

  return false;
}

function checkIpv4String(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length === 4) {
    const octets = parts.map((p) => Number(p));
    const allValid = octets.every(
      (n, i) => !Number.isNaN(n) && n >= 0 && n <= 255 && String(n) === parts[i],
    );
    if (allValid) {
      return isIpv4InSubnet(octets);
    }
  }
  return false;
}

function isIpv6Local(host: string): boolean {
  const normalized = host.toLowerCase();

  // Loopback ::1 or unspecified ::
  if (normalized === "::1" || normalized === "::") return true;

  // Link-local fe80::/10 (fe80 to febf)
  if (/^fe[89ab][0-9a-f]/i.test(normalized)) return true;

  // Unique Local Addresses (fc00::/7 -> fc00 to fdff)
  if (/^f[cd][0-9a-f]{2}/i.test(normalized)) return true;

  return false;
}

/**
 * Checks whether the given URL, host, or IP address resolves to a local/LAN endpoint.
 */
export function isLanAddress(urlOrHost: string): boolean {
  const host = extractHostname(urlOrHost);
  if (!host) {
    return false;
  }

  // Loopback and mDNS hostnames
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "local" || host.endsWith(".local")) {
    return true;
  }

  // IPv4 check
  if (checkIpv4String(host)) {
    return true;
  }

  // IPv6 check
  if (host.includes(":")) {
    // Check IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1 or canonical hex ::ffff:c0a8:101)
    const dotMatch = host.match(/(?:^|:)ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (dotMatch?.[1]) {
      return checkIpv4String(dotMatch[1]);
    }
    const hexMatch = host.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch?.[1] && hexMatch?.[2]) {
      const h1 = Number.parseInt(hexMatch[1], 16);
      const h2 = Number.parseInt(hexMatch[2], 16);
      const octets = [(h1 >> 8) & 0xff, h1 & 0xff, (h2 >> 8) & 0xff, h2 & 0xff];
      return isIpv4InSubnet(octets);
    }
    return isIpv6Local(host);
  }

  return false;
}
