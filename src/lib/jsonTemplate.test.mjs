import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnoseJsonWithTemplates,
  formatJsonWithTemplates,
  minifyJsonWithTemplates,
  validateJsonWithTemplates,
} from "./jsonTemplate.ts";

test("formats JSON with template variables in strings and unquoted values", () => {
  const input = `{
"title": "Hello from {{steps.get-user.response.body.name}}",
"body": "User {{steps.get-user.response.body.username}} ({{steps.get-user.response.body.email}}) says hi.",
"userId": {{steps.get-user.response.body.id}},
"enabled": {{env.ENABLE_FEATURE}}
}`;

  const formatted = formatJsonWithTemplates(input);

  assert.equal(
    formatted,
    `{\n  "title": "Hello from {{steps.get-user.response.body.name}}",\n  "body": "User {{steps.get-user.response.body.username}} ({{steps.get-user.response.body.email}}) says hi.",\n  "userId": {{steps.get-user.response.body.id}},\n  "enabled": {{env.ENABLE_FEATURE}}\n}`
  );
});

test("minifies JSON with template variables in strings and unquoted values", () => {
  const input = `{
  "title": "Hello from {{steps.get-user.response.body.name}}",
  "userId": {{steps.get-user.response.body.id}}
}`;

  const minified = minifyJsonWithTemplates(input);

  assert.equal(
    minified,
    `{"title":"Hello from {{steps.get-user.response.body.name}}","userId":{{steps.get-user.response.body.id}}}`
  );
});

test("validates valid JSON containing template variables", () => {
  const input = `{\n  "userId": {{steps.get-user.response.body.id}}\n}`;
  const res = validateJsonWithTemplates(input);
  assert.equal(res.valid, true);
});

test("returns invalid for genuinely broken JSON syntax", () => {
  const input = `{\n  "userId": {{steps.get-user.response.body.id}} "broken":\n}`;
  const res = validateJsonWithTemplates(input);
  assert.equal(res.valid, false);
  assert.ok(res.error);
});

test("diagnose: clean for valid JSON with template variables in every position", () => {
  const input = `{
  "userId": {{steps.get-user.response.body.id}},
  "enabled": {{env.ENABLE_FEATURE}},
  "title": "Hello {{user.name}}",
  {{dynamic.key}}: "templated key",
  "list": [{{a}}, 1, "x", null, true]
}`;
  assert.deepEqual(diagnoseJsonWithTemplates(input), []);
});

test("diagnose: clean for root-level template, plain JSON, and empty input", () => {
  assert.deepEqual(diagnoseJsonWithTemplates("{{body}}"), []);
  assert.deepEqual(diagnoseJsonWithTemplates('{"a": [1, 2.5e3, -4, "s"]}'), []);
  assert.deepEqual(diagnoseJsonWithTemplates(""), []);
  assert.deepEqual(diagnoseJsonWithTemplates("  \n  "), []);
});

test("diagnose: missing colon after property name reports the true position", () => {
  const input = `{
  "userId": {{steps.get-user.response.body.id}},
  "name" "x"
}`;
  const [d] = diagnoseJsonWithTemplates(input);
  assert.match(d.message, /Expected ':' after property name/);
  assert.equal(d.startLine, 3);
  assert.equal(d.startColumn, 10); // squiggle lands on the "x" that should have been a ':'
});

test("diagnose: missing comma between properties", () => {
  const input = `{
  "a": 1
  "b": 2
}`;
  const [d] = diagnoseJsonWithTemplates(input);
  assert.match(d.message, /Expected ',' or '}'/);
  assert.equal(d.startLine, 3);
  assert.equal(d.startColumn, 3);
});

test("diagnose: real error after a template line squiggles the error, not the template", () => {
  const input = `[{{a}}, {{b}} 5]`;
  const [d] = diagnoseJsonWithTemplates(input);
  assert.match(d.message, /Expected ',' or ']'/);
  assert.equal(d.startLine, 1);
  assert.equal(d.startColumn, 15);
});

test("diagnose: trailing commas rejected in objects and arrays", () => {
  assert.match(diagnoseJsonWithTemplates('{"a": 1,}')[0].message, /Trailing comma/);
  assert.match(diagnoseJsonWithTemplates("[1, 2,]\n")[0].message, /Trailing comma/);
});

test("diagnose: unterminated string, object, and extra closing bracket", () => {
  assert.match(diagnoseJsonWithTemplates('{"a": "x}')[0].message, /Unterminated string/);
  assert.match(diagnoseJsonWithTemplates('{"a": 1')[0].message, /Unterminated object/);
  const [d] = diagnoseJsonWithTemplates('{"a": 1}}');
  assert.match(d.message, /Unexpected content after the JSON value/);
  assert.equal(d.startColumn, 9);
});

test("diagnose: barewords and bad escapes are real errors, comments are tolerated", () => {
  assert.match(diagnoseJsonWithTemplates('{ "a": undefined }')[0].message, /Unexpected token "undefined"/);
  assert.match(diagnoseJsonWithTemplates('{ "a": "\\x" }')[0].message, /Invalid escape/);
  assert.deepEqual(diagnoseJsonWithTemplates('// heading\n{ "a": 1 /* inline */ }'), []);
});
