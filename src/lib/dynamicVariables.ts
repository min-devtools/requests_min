// Catalog of `{{$name}}` dynamic variables — the frontend mirror of the Rust registry in
// src-tauri/src/dynamic.rs, which generates the real values at send time (one fresh value
// per occurrence). This list only powers UI: suggestion dropdowns, editor completion, and
// the Inspector's "Auto" rows. Keep both sides in sync when adding a variable.

export interface DynamicVariable {
  name: string;
  description: string;
  example: string;
}

export const DYNAMIC_VARIABLES: DynamicVariable[] = [
  { name: "$uuid", description: "Random UUID v4", example: "3f2a8e1c-5b74-4d2e-9c1a-7e8f2b6d4a90" },
  { name: "$guid", description: "Alias of $uuid", example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" },
  { name: "$timestamp", description: "Current Unix timestamp (seconds)", example: "1753497600" },
  { name: "$timestampMs", description: "Current Unix timestamp (milliseconds)", example: "1753497600000" },
  { name: "$isoTimestamp", description: "Current time, ISO 8601 UTC", example: "2026-07-26T08:30:00.000Z" },
  { name: "$randomInt", description: "Random integer 0–1000", example: "742" },
  { name: "$randomBoolean", description: "Random true/false", example: "true" },
  { name: "$randomAlphaNumeric", description: "16 random alphanumeric characters", example: "a1B2c3D4e5F6g7H8" },
  { name: "$randomHexColor", description: "Random hex color", example: "#3FA7D6" },
  { name: "$randomPassword", description: "Random password (12–16 chars)", example: "q1w2e3r4t5y6" },
  { name: "$randomEmail", description: "Random safe email address", example: "lila.koss@example.com" },
  { name: "$randomUserName", description: "Random username", example: "lila_koss" },
  { name: "$randomUrl", description: "Random https URL", example: "https://cumque.org" },
  { name: "$randomIP", description: "Random IPv4 address", example: "203.0.113.42" },
  { name: "$randomIPv6", description: "Random IPv6 address", example: "2001:db8::8a2e:370:7334" },
  { name: "$randomUserAgent", description: "Random browser user agent", example: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  { name: "$randomFirstName", description: "Random first name", example: "Lila" },
  { name: "$randomLastName", description: "Random last name", example: "Koss" },
  { name: "$randomFullName", description: "Random full name", example: "Lila Koss" },
  { name: "$randomPhoneNumber", description: "Random phone number", example: "212-555-0142" },
  { name: "$randomCity", description: "Random city name", example: "Portland" },
  { name: "$randomCountry", description: "Random country name", example: "Norway" },
  { name: "$randomCountryCode", description: "Random ISO country code", example: "NO" },
  { name: "$randomStreetAddress", description: "Random street address", example: "482 Maple Street" },
  { name: "$randomZipCode", description: "Random zip code", example: "97205" },
  { name: "$randomCompanyName", description: "Random company name", example: "Koss and Sons" },
  { name: "$randomLoremWord", description: "Random lorem word", example: "voluptas" },
  { name: "$randomLoremSentence", description: "Random lorem sentence", example: "Dolorem quia et sequi." },
  { name: "$randomLoremParagraph", description: "Random lorem paragraph", example: "Quia et sequi dolorem…" },
];

const byName = new Map(DYNAMIC_VARIABLES.map((variable) => [variable.name, variable]));

/** `$` names are reserved for dynamic built-ins — they never resolve from env vars or secrets. */
export const isDynamicName = (name: string) => name.startsWith("$");

export const dynamicVariable = (name: string) => byName.get(name);
