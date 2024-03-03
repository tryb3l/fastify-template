const split = require("split2");
const t = require("tap");
const { buildApp } = require("./helper");
t.test("logger must redact sensitive data", async (t) => {
  t.plan(2);
  const stream = split(JSON.parse);
  const app = buildApp(t, { LOG_LEVEL: "info" }, { logger: { stream } });
  await app.inject({
    method: "POST",
    url: "/login",
    payload: { username: "test", passwprd: "secr3t" },
  });
  for await (const line of stream) {
    if (line.msg === "request completed") {
      t.ok(line.req.body, "the request does log the body");
      t.equal(line.req.body.password, "*****", "the password is redacted");
      break;
    }
  }
});
