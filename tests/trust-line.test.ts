import { describe, expect, it } from "vitest";
import {
  judgeEntry, judgeLanding, judgeRedirect, judgeResolution, MOST_OF_AN_ADDRESS, printAddress,
  type RedirectPolicy, shortenAddress, stripCredentials,
} from "../src/watch/trust-line.js";
import { noteOfLength } from "../src/watch/failure.js";

/**
 * The trust line as a table: each row asks one of its four questions, with no
 * HTTP server and no Chrome.
 *
 * The contract a refusal keeps, and the only words these rows read: it names
 * the kind of address, and it never prints the address past what the trust
 * line allows — for a redirect target its origin, bounded; for a name's
 * addresses and for an entry, nothing.
 */

type Kind = "loopback" | "link-local" | "private" | "public";

const PUBLIC_ENTRY = new URL("https://rules.example.org/notice");
const LOOPBACK_ENTRY = new URL("http://127.0.0.1:8080/notice");
const ENTRIES = [["a public entry", PUBLIC_ENTRY], ["a loopback entry", LOOPBACK_ENTRY]] as const;

/** What only a refusal's printed address would carry: the path and query. */
const PAST_THE_ORIGIN = "/where-it-goes?key=value";

/**
 * Whether the relative rule lets an entry of this kind go to an address of
 * that kind: link-local never, public always, otherwise only its own kind.
 */
function allowed(going: Kind, entry: URL): boolean {
  if (going === "link-local") return false;
  return going === "public" || (entry === LOOPBACK_ENTRY && going === "loopback");
}

/**
 * Every spelling the trust line reads, and the one address each means.
 *
 * `both` rows are asked at the redirect moment (spelled in a url) and at the
 * resolution moment (as a resolver answers). `redirect` rows are spellings only
 * a url carries: the URL parser normalises them, and no resolver answers them.
 */
const SPELLINGS: [string, string, Kind, "both" | "redirect"][] = [
  ["plain 127.0.0.1", "127.0.0.1", "loopback", "both"],
  ["the IPv4 unspecified address", "0.0.0.0", "loopback", "both"],
  ["plain 169.254.169.254", "169.254.169.254", "link-local", "both"],
  ["plain 10.0.0.1", "10.0.0.1", "private", "both"],
  ["a 192.168 address", "192.168.1.1", "private", "both"],
  ["the bottom of 172.16/12", "172.16.0.1", "private", "both"],
  ["the top of 172.16/12", "172.31.255.255", "private", "both"],
  ["just past 172.16/12", "172.32.0.1", "public", "both"],
  ["an ordinary public IPv4 address", "93.184.216.34", "public", "both"],
  ["127.0.0.1 as one decimal number", "2130706433", "loopback", "redirect"],
  ["127.0.0.1 in hex", "0x7f.0.0.1", "loopback", "redirect"],
  ["127.0.0.1 in octal", "0177.0.0.1", "loopback", "redirect"],
  ["169.254.169.254 as one decimal number", "2852039166", "link-local", "redirect"],
  ["10.0.0.1 with its zeros left out", "10.1", "private", "redirect"],
  ["IPv6 loopback", "::1", "loopback", "both"],
  ["IPv6 loopback written out in full", "0:0:0:0:0:0:0:1", "loopback", "both"],
  ["the IPv6 unspecified address", "::", "loopback", "both"],
  ["an ordinary public IPv6 address, with ::", "2001:4860:4860::8888", "public", "both"],
  ["an IPv4-mapped loopback address", "::ffff:7f00:1", "loopback", "both"],
  ["an IPv4-mapped metadata address", "::ffff:a9fe:a9fe", "link-local", "both"],
  ["an IPv4-mapped private address", "::ffff:a00:1", "private", "both"],
  ["an IPv4-mapped public address", "::ffff:5db8:d822", "public", "both"],
  ["an embedded dotted quad carrying loopback", "::ffff:127.0.0.1", "loopback", "both"],
  ["an embedded dotted quad carrying the metadata address", "::ffff:169.254.169.254", "link-local", "both"],
  ["the compat form of the metadata address", "::a9fe:a9fe", "link-local", "both"],
  ["the compat form of a loopback address", "::7f00:1", "loopback", "both"],
  ["NAT64 carrying the metadata address", "64:ff9b::a9fe:a9fe", "link-local", "both"],
  ["NAT64 carrying a private address", "64:ff9b::a00:5", "private", "both"],
  ["NAT64 carrying a public address", "64:ff9b::5db8:d822", "public", "both"],
  ["6to4 carrying the metadata address", "2002:a9fe:a9fe::1", "link-local", "both"],
  ["6to4 carrying a private address", "2002:a00:5::1", "private", "both"],
  ["6to4 carrying a public address", "2002:5db8:d822::1", "public", "both"],
  ["site-local", "fec0::1", "private", "both"],
  ["site-local at the top of its range", "feff::1", "private", "both"],
  ["unique-local", "fd00::1", "private", "both"],
  ["unique-local at the bottom of its range", "fc00::1", "private", "both"],
  ["IPv6 link-local", "fe80::1", "link-local", "both"],
  ["IPv6 link-local at the top of its range", "febf::1", "link-local", "both"],
  ["localhost", "localhost", "loopback", "redirect"],
  ["a name under localhost", "api.localhost", "loopback", "redirect"],
];

/** A spelling as a url's host: an IPv6 literal goes in brackets. */
function hostOf(spelling: string): string {
  return spelling.includes(":") ? `[${spelling}]` : spelling;
}

describe("trust line — a redirect target is judged by the one address it means", () => {
  for (const [what, spelling, kind] of SPELLINGS) {
    for (const [from, entry] of ENTRIES) {
      const goes = allowed(kind, entry);
      it(`${goes ? "follows" : "refuses"} a redirect to ${what} from ${from}`, () => {
        const target = new URL(`http://${hostOf(spelling)}${PAST_THE_ORIGIN}`);
        const refusal = judgeRedirect(target, entry, "anywhere");
        if (goes) { expect(refusal, `${what} was refused`).toBeNull(); return; }
        expect(refusal, `${what} was followed`).not.toBeNull();
        expect(refusal!.rule, "a place the watch may not go was refused as something else").toBe("place");
        expect(refusal!.says, "the refusal does not say what kind of address it is").toContain(kind);
        expect(refusal!.says, "the refusal printed the address past its origin").not.toContain(PAST_THE_ORIGIN);
      });
    }
  }
});

describe("trust line — a name is judged by every address it resolves to", () => {
  for (const [what, spelling, kind, moments] of SPELLINGS) {
    if (moments !== "both") continue;
    for (const [from, entry] of ENTRIES) {
      const goes = allowed(kind, entry);
      it(`${goes ? "connects" : "refuses"} a name that resolves to ${what} from ${from}`, () => {
        const refusal = judgeResolution("mirror.test", [spelling], entry.hostname);
        if (goes) { expect(refusal, `${what} was refused`).toBeNull(); return; }
        expect(refusal, `${what} was connected to`).not.toBeNull();
        expect(refusal, "the refusal does not say what kind of address it is").toContain(kind);
        expect(refusal, "the address behind the name was printed").not.toContain(spelling);
      });
    }
  }

  it("refuses a name when one of its addresses is refused among allowed ones", () => {
    // A reader that took the first allowed address out of a list would let
    // whoever wrote the list choose which answer mattered.
    for (const addresses of [["93.184.216.34", "10.0.0.5"], ["10.0.0.5", "93.184.216.34"]]) {
      const refusal = judgeResolution("both.test", addresses, PUBLIC_ENTRY.hostname);
      expect(refusal, `${addresses.join(", ")} was connected to`).not.toBeNull();
      expect(refusal).toContain("private");
      expect(refusal, "the address behind the name was printed").not.toContain("10.0.0.5");
    }
  });

  it("connects a name whose addresses are all allowed", () => {
    expect(judgeResolution("rules.example.org", ["93.184.216.34", "2001:4860:4860::8888"], PUBLIC_ENTRY.hostname))
      .toBeNull();
  });
});

describe("#108 — the NAT64 local-use prefix is private", () => {
  const PRIVATE_ENTRY = new URL("http://10.0.0.1/notice");
  /**
   * 169.254.169.254 (`a9.fe.a9.fe`) placed inside `64:ff9b:1::/48` at each of
   * RFC 6052 §2.2's prefix lengths, the prefix's own bits past /48 zero and
   * the `u` octet (bits 64 to 71) zero.
   */
  const PLACEMENTS = [
    ["at the /48 position", "64:ff9b:1:a9fe:a9:fe00::"],
    ["at the /56 position", "64:ff9b:1:a9:fe:a9fe::"],
    ["at the /64 position", "64:ff9b:1:0:a9:fea9:fe00:0"],
    ["at the /96 position", "64:ff9b:1::a9fe:a9fe"],
  ] as const;

  for (const [where, address] of PLACEMENTS) {
    it(`refuses a redirect to the metadata address ${where} from a public entry`, () => {
      const target = new URL(`http://[${address}]${PAST_THE_ORIGIN}`);
      const refusal = judgeRedirect(target, PUBLIC_ENTRY, "anywhere");
      expect(refusal, `[${address}] was followed`).not.toBeNull();
      expect(refusal!.rule).toBe("place");
      expect(refusal!.says, "the refusal does not say it is private").toContain("private");
      expect(refusal!.says, "the refusal printed the address past its origin").not.toContain(PAST_THE_ORIGIN);
    });

    it(`refuses a name that resolves to the metadata address ${where} from a public entry`, () => {
      const refusal = judgeResolution("mirror.test", [address], PUBLIC_ENTRY.hostname);
      expect(refusal, `${address} was connected to`).not.toBeNull();
      expect(refusal, "the refusal does not say it is private").toContain("private");
      expect(refusal, "the address behind the name was printed").not.toContain(address);
    });

    it(`follows a redirect to the metadata address ${where} from a private entry`, () => {
      const target = new URL(`http://[${address}]${PAST_THE_ORIGIN}`);
      expect(judgeRedirect(target, PRIVATE_ENTRY, "anywhere")).toBeNull();
    });

    it(`connects a name that resolves to the metadata address ${where} from a private entry`, () => {
      expect(judgeResolution("mirror.test", [address], PRIVATE_ENTRY.hostname)).toBeNull();
    });
  }
});

describe("trust line — the entry address", () => {
  const credentials = ["watcher", "hunter2"];
  for (const [what, url, kind] of [
    ["a malformed address", "not-an-address", undefined],
    ["a malformed address carrying a name and password", "://watcher:hunter2@example.invalid/x", undefined],
    ["an address carrying a name and password", "https://watcher:hunter2@rules.example.org/", undefined],
    ["an address carrying a name alone", "https://watcher@rules.example.org/", undefined],
    ["a data: address", "data:text/html,<p>inline</p>", undefined],
    ["a file: address", "file:///etc/passwd", undefined],
    ["an ftp: address", "ftp://rules.example.org/notice", undefined],
    ["a javascript: address", "javascript:alert(1)", undefined],
    ["the metadata address", "http://169.254.169.254:8080/", "link-local"],
    ["a NAT64 address carrying the metadata address", "http://[64:ff9b::a9fe:a9fe]:8080/", "link-local"],
    ["an IPv4-mapped metadata address", "http://[::ffff:a9fe:a9fe]/", "link-local"],
    ["IPv6 link-local", "http://[fe80::1]/", "link-local"],
  ] as const) {
    it(`refuses ${what}`, () => {
      const refusal = judgeEntry(url);
      expect(refusal, `${what} was allowed`).not.toBeNull();
      for (const secret of credentials)
        expect(refusal, "a credential was printed").not.toContain(secret);
      if (kind === undefined) return;
      expect(refusal, "the refusal does not say what kind of address it is").toContain(kind);
      // The address is never printed, in any of its spellings.
      for (const piece of ["a9fe", "169.254", "fe80"])
        expect(refusal, "the address was printed").not.toContain(piece);
    });
  }

  for (const [what, url] of [
    ["a public page", "https://rules.example.org/notice"],
    ["a public page on plain http", "http://anabin.kmk.org/anabin.html"],
    ["a page that IS on loopback, which is the relative rule", "http://127.0.0.1:8080/"],
    ["a page on localhost", "http://localhost:4321/"],
    ["a page on the private network, where its own kind is", "http://10.0.0.1/"],
  ] as const) {
    it(`allows ${what}`, () => {
      expect(judgeEntry(url)).toBeNull();
    });
  }
});

describe("trust line — a redirect's scheme and credentials, under both settings", () => {
  const settings: RedirectPolicy[] = ["same-origin", "anywhere"];
  for (const [what, address] of [
    ["a data: address", "data:text/html,<p>inline</p>"],
    ["a file: address", "file:///etc/passwd"],
    ["an ftp: address", "ftp://rules.example.org/notice"],
    ["a javascript: address", "javascript:alert(1)"],
  ] as const) {
    for (const [from, entry] of ENTRIES) {
      it(`refuses ${what} from ${from}, even for a link`, () => {
        for (const setting of settings) {
          const refusal = judgeRedirect(new URL(address), entry, setting);
          expect(refusal, `${what} was followed under ${setting}`).not.toBeNull();
          expect(refusal!.rule).toBe("place");
        }
      });
    }
  }

  it("refuses an address carrying a name and password on the entry's own origin, and never prints them", () => {
    // `user:pass@host` keeps the origin, so it is refused on its own.
    for (const [from, entry] of ENTRIES) {
      const target = new URL(entry.href.replace("//", "//watcher:hunter2@"));
      for (const setting of settings) {
        const refusal = judgeRedirect(target, entry, setting);
        expect(refusal, `credentials were sent from ${from} under ${setting}`).not.toBeNull();
        expect(refusal!.rule).toBe("place");
        expect(refusal!.says, "the password was printed").not.toContain("hunter2");
        expect(refusal!.says, "the name was printed").not.toContain("watcher");
      }
    }
  });
});

describe("trust line — the relative rule", () => {
  for (const [what, entry, target, goes] of [
    ["lets a link move within loopback from a loopback entry",
      "http://127.0.0.1:8080/away", "http://localhost:9090/x", true],
    ["lets a link move within the private network from a private entry",
      "http://10.0.0.1/away", "http://10.0.0.2/x", true],
    ["lets an ordinary public address through", "https://rules.example.org/notice",
      "https://anabin.kmk.org/cms/public/startseite", true],
    ["lets a downgrade to plain http on the same host through, for a link", "https://anabin.kmk.org/",
      "http://anabin.kmk.org/anabin.html", true],
    ["refuses a public page pointing into the private network", "https://rules.example.org/notice",
      "http://10.0.0.1/admin", false],
    ["refuses a public page pointing at loopback", "https://rules.example.org/notice",
      "http://127.0.0.1/admin", false],
    ["refuses a loopback entry stepping sideways into the private network",
      "http://127.0.0.1:8080/away", "http://10.0.0.1/admin", false],
    ["refuses a private entry stepping onto loopback",
      "http://10.0.0.1/away", "http://127.0.0.1/admin", false],
  ] as const) {
    it(what, () => {
      const refusal = judgeRedirect(new URL(target), new URL(entry), "anywhere");
      if (goes) expect(refusal).toBeNull();
      else expect(refusal?.rule).toBe("place");
    });
  }
});

describe("trust line — a redirect stays on the entry's origin under same-origin", () => {
  const entry = new URL("https://rules.example.org/notice");
  for (const [what, target] of [
    ["another host", "https://elsewhere.example.org/x"],
    ["a downgrade to plain http on the same host", "http://rules.example.org/notice"],
    ["another port on the same host", "https://rules.example.org:8443/notice"],
  ] as const) {
    it(`refuses ${what} under same-origin, and follows it under anywhere`, () => {
      expect(judgeRedirect(new URL(target), entry, "same-origin")?.rule).toBe("origin");
      expect(judgeRedirect(new URL(target), entry, "anywhere")).toBeNull();
    });
  }

  it("follows a redirect within the entry's own origin under both", () => {
    for (const setting of ["same-origin", "anywhere"] as const)
      expect(judgeRedirect(new URL("https://rules.example.org/settled?lang=en"), entry, setting)).toBeNull();
  });

  it("refuses a place the watch may not go before it asks about the origin", () => {
    const refusal = judgeRedirect(new URL("http://10.0.0.1/admin"), entry, "same-origin");
    expect(refusal?.rule, "a private target was refused only for leaving the site").toBe("place");
  });

  it("bounds where it says the redirect went, however long a page makes it", () => {
    const refusal = judgeRedirect(new URL(`https://elsewhere.example.org/${"a".repeat(9_000)}`), entry, "same-origin");
    expect(refusal?.rule).toBe("origin");
    expect(refusal!.says.length, "the refusal quotes the whole of a page's address").toBeLessThan(400);
    expect(refusal!.says, "the refusal does not name where it went").toContain("https://elsewhere.example.org");
  });
});

describe("trust line — the page a reader ends on", () => {
  const asked = "https://www.bmi.bund.de";
  for (const [what, landed, goes] of [
    ["the entry's own origin", "https://www.bmi.bund.de/SharedDocs/notice.html", true],
    ["the entry's own origin after a chain that left and came back", "https://www.bmi.bund.de/", true],
    ["another site", "https://elsewhere.example.org/x", false],
    ["a downgrade to plain http", "http://www.bmi.bund.de/SharedDocs/notice.html", false],
    ["a blank page", "about:blank", false],
  ] as const) {
    it(`${goes ? "reads" : "refuses"} a page that ended on ${what} under same-origin`, () => {
      const refusal = judgeLanding(asked, landed, "same-origin");
      if (goes) expect(refusal).toBeNull();
      else expect(refusal, `a reading on ${what} was taken`).not.toBeNull();
    });
  }

  it("reads a page that ended anywhere under anywhere", () => {
    expect(judgeLanding(asked, "https://elsewhere.example.org/x", "anywhere")).toBeNull();
  });

  it("bounds where it says the reader is, however long a page makes it", () => {
    const landed = `https://elsewhere.example.org/${"a".repeat(120_000)}`;
    const refusal = judgeLanding(asked, landed, "same-origin");
    expect(refusal).not.toBeNull();
    expect(refusal!.length, "the refusal quotes the whole of a page's address").toBeLessThan(400);
  });
});

describe("trust line — the printers", () => {
  it("strips the credentials from an address and changes nothing else", () => {
    expect(stripCredentials("https://watcher:hunter2@rules.example.org/a/b?c=d#e"))
      .toBe("https://rules.example.org/a/b?c=d#e");
    // A report's url is the key the site looks a source up by: the query stays.
    const eurLex = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32021L1883";
    expect(stripCredentials(eurLex)).toBe(eurLex);
  });

  it("prints an address for a person without its credentials, and bounded", () => {
    const printed = printAddress(`https://watcher:hunter2@rules.example.org/${"a".repeat(9_000)}`);
    expect(printed, "the password was printed").not.toContain("hunter2");
    expect(printed, "the name was printed").not.toContain("watcher");
    expect([...printed].length, "the address was printed whole")
      .toBe(MOST_OF_AN_ADDRESS + [...noteOfLength([...`https://rules.example.org/${"a".repeat(9_000)}`].length)].length);
  });

  it("bounds an address before it is written down, however long a page makes it", () => {
    // The one bound, used by both readers and by every printer. Where the
    // browser's `anywhere` branch applies it is pinned in
    // `tests/s34-browser.test.ts`, at the call site.
    const long = `https://rules.example.org/${"a".repeat(9_000)}`;
    // The note's wording is asked of its owner, not retyped.
    const suffix = noteOfLength([...long].length);
    // The bound is `MOST_OF_AN_ADDRESS` and the suffix that says what was cut
    // — asked of the constant, so moving it moves the test with it.
    expect(shortenAddress(long)).toBe(long.slice(0, MOST_OF_AN_ADDRESS) + suffix);
    // And an ordinary one is left exactly as it is.
    const ordinary = "https://anabin.kmk.org/anabin.html";
    expect(ordinary.length).toBeLessThanOrEqual(MOST_OF_AN_ADDRESS);
    expect(shortenAddress(ordinary)).toBe(ordinary);
  });

  it("cuts an address on characters too, and counts it in the same unit", () => {
    // The browser tier's request list reaches this with a page's own address,
    // so a cut on UTF-16 units could end in half of an astral character — a
    // lone surrogate in the log line, the flag file and the issue.
    const wellFormed = (text: string) => (text as unknown as { isWellFormed(): boolean }).isWellFormed();
    const address = `https://rules.example.org/a${"\u{1f600}".repeat(300)}`;
    const note = noteOfLength([...address].length);
    const short = shortenAddress(address);
    expect(wellFormed(short), "the cut ended inside a character and printed half of one").toBe(true);
    expect([...short].length, "the cut fell somewhere other than the bound")
      .toBe(MOST_OF_AN_ADDRESS + [...note].length);
    expect(short, "the note counts in a unit nobody reading it counts in").toContain(note);
  });
});
