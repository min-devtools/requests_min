#[test]
fn empty_repositories_are_initialized_before_the_first_push() {
    let source = std::fs::read_to_string("src/github.rs").unwrap();

    assert!(source.contains("async fn put_json"));
    assert!(source.contains("/contents/.requestsmin"));
    assert!(source.contains("store_set(&app, \"branch\""));
    assert!(source.contains("default_branch"));
}
