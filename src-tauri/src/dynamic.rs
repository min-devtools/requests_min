// Dynamic variables: `{{$name}}` tokens resolved at send time, one fresh value per
// occurrence (Postman semantics — see docs/superpowers/specs/2026-07-26-dynamic-variables-design.md).
// The `$` namespace is reserved: interpolate() routes here and never consults env/secrets.
// Fake data comes from the `fake` crate; names mirror Postman's where an equivalent exists.
// The frontend keeps a matching catalog in src/lib/dynamicVariables.ts.

use fake::faker::address::en::{BuildingNumber, CityName, CountryCode, CountryName, StreetName, ZipCode};
use fake::faker::company::en::CompanyName;
use fake::faker::internet::en::{DomainSuffix, IPv4, IPv6, Password, SafeEmail, UserAgent, Username};
use fake::faker::lorem::en::{Paragraph, Sentence, Word};
use fake::faker::name::en::{FirstName, LastName, Name};
use fake::faker::phone_number::en::PhoneNumber;
use fake::Fake;
use rand::{distributions::Alphanumeric, Rng};

/// `name` arrives without its `$` prefix. `None` means "not a built-in" and turns
/// into an "unknown dynamic variable" send error in interpolate().
pub fn dynamic_value(name: &str) -> Option<String> {
    let value = match name {
        "uuid" | "guid" => uuid::Uuid::new_v4().to_string(),
        "timestamp" => chrono::Utc::now().timestamp().to_string(),
        "timestampMs" => chrono::Utc::now().timestamp_millis().to_string(),
        "isoTimestamp" => chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "randomInt" => rand::thread_rng().gen_range(0..=1000).to_string(),
        "randomBoolean" => rand::thread_rng().gen_bool(0.5).to_string(),
        "randomAlphaNumeric" => rand::thread_rng().sample_iter(&Alphanumeric).take(16).map(char::from).collect(),
        "randomHexColor" => format!("#{:06X}", rand::thread_rng().gen_range(0..0x100_0000)),
        "randomPassword" => Password(12..17).fake(),
        "randomEmail" => SafeEmail().fake(),
        "randomUserName" => Username().fake(),
        "randomUrl" => format!("https://{}.{}", Word().fake::<String>(), DomainSuffix().fake::<String>()),
        "randomIP" => IPv4().fake(),
        "randomIPv6" => IPv6().fake(),
        "randomUserAgent" => UserAgent().fake(),
        "randomFirstName" => FirstName().fake(),
        "randomLastName" => LastName().fake(),
        "randomFullName" => Name().fake(),
        "randomPhoneNumber" => PhoneNumber().fake(),
        "randomCity" => CityName().fake(),
        "randomCountry" => CountryName().fake(),
        "randomCountryCode" => CountryCode().fake(),
        "randomStreetAddress" => format!("{} {}", BuildingNumber().fake::<String>(), StreetName().fake::<String>()),
        "randomZipCode" => ZipCode().fake(),
        "randomCompanyName" => CompanyName().fake(),
        "randomLoremWord" => Word().fake(),
        "randomLoremSentence" => Sentence(4..10).fake(),
        "randomLoremParagraph" => Paragraph(2..4).fake(),
        _ => return None,
    };
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::dynamic_value;

    fn v(name: &str) -> String {
        dynamic_value(name).unwrap_or_else(|| panic!("built-in ${name} returned None"))
    }

    #[test]
    fn unknown_name_is_none() {
        assert_eq!(dynamic_value("nope"), None);
        assert_eq!(dynamic_value(""), None);
        assert_eq!(dynamic_value("UUID"), None); // case-sensitive
    }

    #[test]
    fn uuid_and_guid_are_v4_format() {
        for name in ["uuid", "guid"] {
            let s = v(name);
            let parts: Vec<&str> = s.split('-').collect();
            assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), vec![8, 4, 4, 4, 12], "${name} => {s}");
            assert!(s.chars().all(|c| c.is_ascii_hexdigit() || c == '-'), "${name} => {s}");
        }
    }

    #[test]
    fn uuid_is_fresh_every_call() {
        assert_ne!(v("uuid"), v("uuid"));
    }

    #[test]
    fn timestamps_are_numeric_and_consistent() {
        let s: i64 = v("timestamp").parse().unwrap();
        let ms: i64 = v("timestampMs").parse().unwrap();
        assert!(s > 1_700_000_000, "unix seconds sanity: {s}");
        assert!(ms / 1000 - s < 5, "ms and s should be within seconds of each other");
        let iso = v("isoTimestamp");
        chrono::DateTime::parse_from_rfc3339(&iso).unwrap_or_else(|e| panic!("isoTimestamp {iso}: {e}"));
        assert!(iso.ends_with('Z'), "UTC zulu suffix: {iso}");
    }

    #[test]
    fn random_int_in_range_and_boolean_parses() {
        for _ in 0..50 {
            let n: u32 = v("randomInt").parse().unwrap();
            assert!(n <= 1000, "randomInt out of range: {n}");
        }
        let b = v("randomBoolean");
        assert!(b == "true" || b == "false", "randomBoolean => {b}");
    }

    #[test]
    fn alphanumeric_hex_color_and_password_shapes() {
        let a = v("randomAlphaNumeric");
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()), "{a}");
        let c = v("randomHexColor");
        assert_eq!(c.len(), 7);
        assert!(c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit()), "{c}");
        assert!((12..17).contains(&v("randomPassword").len()));
    }

    #[test]
    fn internet_values_parse() {
        assert!(v("randomEmail").contains('@'));
        assert!(v("randomUrl").starts_with("https://"));
        v("randomIP").parse::<std::net::Ipv4Addr>().unwrap();
        v("randomIPv6").parse::<std::net::Ipv6Addr>().unwrap();
    }

    #[test]
    fn every_registered_name_yields_non_empty() {
        for name in [
            "uuid", "guid", "timestamp", "timestampMs", "isoTimestamp", "randomInt", "randomBoolean",
            "randomAlphaNumeric", "randomHexColor", "randomPassword", "randomEmail", "randomUserName",
            "randomUrl", "randomIP", "randomIPv6", "randomUserAgent", "randomFirstName", "randomLastName",
            "randomFullName", "randomPhoneNumber", "randomCity", "randomCountry", "randomCountryCode",
            "randomStreetAddress", "randomZipCode", "randomCompanyName", "randomLoremWord",
            "randomLoremSentence", "randomLoremParagraph",
        ] {
            assert!(!v(name).is_empty(), "${name} is empty");
        }
    }
}
